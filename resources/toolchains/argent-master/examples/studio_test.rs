//! Local-only Studio bridge. Uses the pinned Argent runtime and real Kaspa VM.
use std::{collections::BTreeMap, fs, io::{self, Read}};
use argent_artifact::{Artifact, TypeArtifact, SilAbiArtifact};
use argent_runtime::{ArtifactBundle, TxBuilder, TxContext, EntryCall, ArgValue, ArtifactValue, BuilderError};
use kaspa_consensus_core::{Hash, hashing::{sighash::{calc_schnorr_signature_hash, SigHashReusedValuesUnsync}, sighash_type::SIG_HASH_ALL}, tx::{CovenantBinding, TransactionId, TransactionOutpoint, ScriptPublicKey, UtxoEntry}};
use secp256k1::{Keypair, Secp256k1, SecretKey};
use serde_json::{Value, json};
type Result<T> = std::result::Result<T, String>;
fn key(s: &str) -> Result<Keypair> {
    let id: u8 = s.parse().map_err(|_| "Test key must be 1..255")?;
    if id == 0 { return Err("Test key must be 1..255".into()); }
    let mut bytes = [0;32]; bytes[31] = id;
    Ok(Keypair::from_secret_key(&Secp256k1::new(), &SecretKey::from_slice(&bytes).map_err(|e|e.to_string())?))
}
fn bytes(v: &Value) -> Result<Vec<u8>> {
    if let Some(s) = v.as_str() {
        if let Some(id) = s.strip_prefix("@test-key:") { return Ok(key(id)?.x_only_public_key().0.serialize().to_vec()); }
        if let Some(id) = s.strip_prefix("@test-hash:") { return Ok(blake2b_simd::Params::new().hash_length(32).hash(&key(id)?.x_only_public_key().0.serialize()).as_bytes().to_vec()); }
        let s = s.strip_prefix("0x").unwrap_or(s);
        if s.len() % 2 != 0 || !s.is_ascii() { return Err("Expected even-length hexadecimal bytes".into()); }
        return (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i+2],16).map_err(|_| "Invalid hexadecimal bytes".into())).collect();
    }
    v.as_array().ok_or("Expected hex string or byte array")?.iter().map(|b| b.as_u64().filter(|n|*n<=255).map(|n|n as u8).ok_or("Invalid byte".into())).collect()
}
fn value(v: &Value, ty: &TypeArtifact, contract: &SilAbiArtifact, builder: &TxBuilder, depth: usize) -> Result<ArtifactValue> {
    if depth > 32 { return Err("Value nesting exceeds 32".into()); }
    if let Some(s) = v.as_str().and_then(|s|s.strip_prefix("@actor-handle:")) {
        let (actor,state)=s.split_once(':').ok_or("Actor handle format: @actor-handle:Actor:State")?;
        return builder.actor_type_handle(actor,state).map(ArtifactValue::Bytes).map_err(|e|e.to_string());
    }
    Ok(match ty {
        TypeArtifact::Int | TypeArtifact::Temporal => ArtifactValue::Int(v.as_i64().ok_or("Expected a signed 64-bit integer")?),
        TypeArtifact::Bool => ArtifactValue::Bool(v.as_bool().ok_or("Expected true or false")?),
        TypeArtifact::Byte => ArtifactValue::Byte(v.as_u64().filter(|n|*n<=255).ok_or("Expected byte 0..255")? as u8),
        TypeArtifact::Text => ArtifactValue::Text(v.as_str().ok_or("Expected a string")?.to_string()),
        TypeArtifact::Struct { name } => {
            let fields=&contract.structs.get(name).ok_or(format!("Unknown struct {name}"))?.fields;
            let object=v.as_object().ok_or("Expected an object")?;
            if object.len()!=fields.len() { return Err(format!("Expected exactly {} fields for {name}",fields.len())); }
            ArtifactValue::Object(fields.iter().map(|f| Ok((f.name.clone(),value(object.get(&f.name).ok_or(format!("Missing {}",f.name))?, &f.ty,contract,builder,depth+1)?))).collect::<Result<_>>()?)
        },
        TypeArtifact::FixedArray { item, len } => {
            let items=v.as_array().ok_or("Expected array")?; if items.len()!=*len { return Err(format!("Expected {len} array elements")); }
            ArtifactValue::Array(items.iter().map(|v|value(v,item,contract,builder,depth+1)).collect::<Result<_>>()?)
        },
        TypeArtifact::DynamicArray { item } => ArtifactValue::Array(v.as_array().ok_or("Expected array")?.iter().map(|v|value(v,item,contract,builder,depth+1)).collect::<Result<_>>()?),
        _ => {
            let data=bytes(v)?;
            let expected=match ty { TypeArtifact::FixedBytes{len}=>Some(*len),TypeArtifact::Pubkey=>Some(32),TypeArtifact::Sig=>Some(65),TypeArtifact::Datasig=>Some(64),_=>None };
            if let Some(len)=expected { if data.len()!=len { return Err(format!("Expected {len} bytes, got {}",data.len())); } }
            ArtifactValue::Bytes(data)
        }
    })
}
fn str_at<'a>(v: &'a Value,k:&str)->Result<&'a str>{v[k].as_str().ok_or(format!("Missing string {k}"))}
fn uint(v:&Value,k:&str,default:u64)->Result<u64>{if v.get(k).is_none(){Ok(default)}else{v[k].as_u64().ok_or(format!("Invalid unsigned integer {k}"))}}
fn hash(v:&Value)->Result<Hash>{let b=bytes(v)?; Ok(Hash::from_bytes(b.try_into().map_err(|_|"Covenant id must be 32 bytes")?))}
fn lookup<'a>(artifacts:&'a [Artifact],name:&str)->Result<(&'a Artifact,&'a argent_artifact::ActorArtifact)> {
    let (app,actor)=name.split_once("::").map(|(a,b)|(Some(a),b)).unwrap_or((None,name));
    let art=if let Some(app)=app{artifacts.iter().find(|a|a.app==app).ok_or(format!("Missing app {app}"))?}else{&artifacts[0]};
    Ok((art,art.argent.actors.iter().find(|a|a.name==actor).ok_or(format!("Unknown actor {name}"))?))
}
fn state(v:&Value,name:&str,artifacts:&[Artifact],builder:&TxBuilder)->Result<BTreeMap<String,ArtifactValue>> {
    let (art,actor)=lookup(artifacts,name)?;
    let fields=&art.argent.states.iter().find(|s|s.name==actor.state).ok_or("Unknown state")?.fields;
    let object=v.as_object().ok_or("State must be an object")?;
    if object.len()!=fields.len(){return Err(format!("State {} needs exactly {} fields",actor.state,fields.len()));}
    let contract=&art.sil_abi;
    fields.iter().map(|f|Ok((f.name.clone(),value(object.get(&f.name).ok_or(format!("Missing state field {}",f.name))?,&f.ty,contract,builder,0)?))).collect()
}
fn run(request:Value)->Result<Value>{
    let mut artifacts=vec![serde_json::from_str::<Artifact>(&fs::read_to_string(str_at(&request,"artifact")?).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?];
    let s=&request["scenario"];
    if s["version"]!=1 {return Err("Unsupported scenario version".into());}
    for path in s["artifacts"].as_array().into_iter().flatten(){artifacts.push(serde_json::from_str(&fs::read_to_string(path.as_str().ok_or("Artifact path must be a string")?).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?);}
    let mut bundle=ArtifactBundle::new(&artifacts[0]).map_err(|e|e.to_string())?;
    for art in &artifacts[1..] { bundle=bundle.with_artifact(art).map_err(|e|e.to_string())?; }
    let builder=TxBuilder::from_bundle(&bundle).map_err(|e|e.to_string())?;
    let inputs=s["inputs"].as_array().ok_or("Missing inputs")?;
    let outputs=s["outputs"].as_array().ok_or("Missing outputs")?;
    if inputs.is_empty()||inputs.len()>64||outputs.len()>128{return Err("Scenario requires 1..64 inputs and at most 128 outputs".into());}
    let default_cov=Value::String("41".repeat(32));
    let mut covs=Vec::new(); let mut context=TxContext::new().lock_time(uint(s,"lock_time",0)?);
    let mut sum_in=0u64; let mut sum_out=0u64;
    for (i,input) in inputs.iter().enumerate(){
        let name=str_at(input,"actor")?; let entry=str_at(input,"entry")?; let (art,actor)=lookup(&artifacts,name)?;
        let e=actor.entries.iter().find(|e|e.name==entry).ok_or("Unknown entry")?;
        let contract=&art.sil_abi.contracts[&e.abi.contract];
        let params:Vec<_>=contract.entries[&e.abi.entry].params.iter().filter(|p|!e.hidden_params.iter().any(|h|h.name==p.name)).collect();
        let args=input["args"].as_array().ok_or("Arguments must be an array")?;
        if args.len()!=params.len(){return Err(format!("{name}.{entry} expects {} arguments",params.len()));}
        let mut prepared=Vec::new();
        for (arg,p) in args.iter().zip(params){
            if matches!(p.ty,TypeArtifact::Sig) && arg.as_str().is_some_and(|s|s.starts_with("@test-key:")){
                prepared.push((None,Some(key(arg.as_str().unwrap().trim_start_matches("@test-key:"))?)));
            }else if let Some(actor)=arg.as_str().and_then(|s|s.strip_prefix("@actor:")) {prepared.push((Some(ArgValue::Actor(actor.to_string())),None));}
            else{prepared.push((Some(ArgValue::Value(value(arg,&p.ty,&art.sil_abi,&builder,0)?)),None));}
        }
        let call=EntryCall::new(entry).args_with(move |tx,index|prepared.iter().map(|(v,k)|{
            if let Some(v)=v{return v.clone();}
            let digest=calc_schnorr_signature_hash(&tx.as_verifiable(),index,SIG_HASH_ALL,&SigHashReusedValuesUnsync::new());
            let msg=secp256k1::Message::from_digest_slice(&digest.as_bytes()).expect("32 byte hash");
            let mut signature=k.as_ref().unwrap().sign_schnorr(msg).as_ref().to_vec(); signature.push(SIG_HASH_ALL.to_u8()); ArgValue::Value(ArtifactValue::Bytes(signature))
        }).collect());
        let cov=hash(input.get("covenant").unwrap_or(&default_cov))?; covs.push(cov);
        let amount=uint(input,"value",100000)?;sum_in=sum_in.checked_add(amount).ok_or("Input amount overflow")?;
        let state=state(&input["state"],name,&artifacts,&builder)?;
        let utxo=builder.covenant_utxo(name,state.clone(),amount,uint(input,"daa",0)?,false,Some(cov)).map_err(|e|e.to_string())?;
        let mut id=[0x51;32];id[0]=i as u8;
        context=context.actor_input(name,state,call,TransactionOutpoint::new(TransactionId::from_bytes(id),0),utxo,uint(input,"sequence",0)?);
    }
    for output in outputs {
        let name=str_at(output,"actor")?;let amount=uint(output,"value",100000)?;sum_out=sum_out.checked_add(amount).ok_or("Output amount overflow")?;
        let index=uint(output,"authorizing_input",0)? as usize;
        let cov=*covs.get(index).ok_or("Invalid authorizing input")?;
        let state=state(&output["state"],name,&artifacts,&builder)?;
        context=if let Some(genesis)=output["genesis"].as_str(){context.actor_genesis_output(index as u16,genesis,name,state,amount)}else{context.actor_output(name,state,CovenantBinding::new(index as u16,cov),amount)};
    }
    let funding=uint(s,"funding",0)?;
    if funding>0 {
        sum_in=sum_in.checked_add(funding).ok_or("Funding overflow")?;
        // Explicit synthetic funding UTXO. Never obtained from a network or wallet.
        context=context.input(TransactionOutpoint::new(TransactionId::from_bytes([0x77;32]),0),UtxoEntry::new(funding,ScriptPublicKey::from_vec(0,vec![0x51]),0,false,None),vec![],0);
    }
    if sum_out>sum_in{return Err(format!("Missing test funding: outputs exceed inputs by {} sompi",sum_out-sum_in));}
    let result=match builder.build(&context){
        Ok(tx)=>json!({"status":"passed","message":"All input scripts passed the local VM; runtime mass checks passed.","inputs":tx.inputs.len(),"outputs":tx.outputs.len(),"fee":sum_in-sum_out,"compute_commit":tx.inputs.iter().map(|i|i.compute_commit).collect::<Vec<_>>() }),
        Err(BuilderError::InputScript{input_index,source})=>json!({"status":"failed","input":input_index,"message":source.to_string()}),
        Err(e)=>json!({"status":"invalid","message":e.to_string()})
    };
    Ok(result)
}
fn main(){
    let mut data=String::new();let result=io::stdin().take(4_000_001).read_to_string(&mut data).map_err(|e|e.to_string()).and_then(|_|if data.len()>4_000_000{Err("Request too large".into())}else{serde_json::from_str(&data).map_err(|e|e.to_string())}).and_then(run);
    println!("{}",result.unwrap_or_else(|e|json!({"status":"invalid","message":e})));
}
