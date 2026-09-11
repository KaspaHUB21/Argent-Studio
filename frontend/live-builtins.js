// Generated from the pinned Argent language service. Run node scripts/sync-live-builtins.mjs.
export const keywords = [
  "actor",
  "app",
  "as",
  "become",
  "by",
  "consumes",
  "const",
  "delegate",
  "else",
  "emits",
  "entry",
  "enum",
  "expands",
  "false",
  "fn",
  "from",
  "if",
  "import",
  "inputs",
  "leader",
  "none",
  "observes",
  "outputs",
  "owns",
  "return",
  "self",
  "spawns",
  "state",
  "true",
  "virtual"
];
export const types = [
  "actor_type",
  "bool",
  "byte",
  "bytes",
  "cov_id",
  "datasig",
  "int",
  "pubkey",
  "sig",
  "string",
  "temporal"
];
export const builtins = [
  {
    "name": "state",
    "signature": "state(input_reference) -> AuthoredState",
    "params": [
      "input_reference"
    ]
  },
  {
    "name": "digest",
    "signature": "digest(authored_state) -> byte[32]",
    "params": [
      "authored_state"
    ]
  },
  {
    "name": "blake2b",
    "signature": "blake2b(data: byte[]) -> byte[32]",
    "params": [
      "data"
    ]
  },
  {
    "name": "blake2bWithKey",
    "signature": "blake2bWithKey(data: byte[], key: byte[]) -> byte[32]",
    "params": [
      "data",
      "key"
    ]
  },
  {
    "name": "blake3",
    "signature": "blake3(data: byte[]) -> byte[32]",
    "params": [
      "data"
    ]
  },
  {
    "name": "blake3WithKey",
    "signature": "blake3WithKey(data: byte[], key: byte[32]) -> byte[32]",
    "params": [
      "data",
      "key"
    ]
  },
  {
    "name": "sha256",
    "signature": "sha256(data: byte[]) -> byte[32]",
    "params": [
      "data"
    ]
  },
  {
    "name": "checkSig",
    "signature": "checkSig(signature: sig, public_key: pubkey) -> bool",
    "params": [
      "signature",
      "public_key"
    ]
  },
  {
    "name": "checkSigEcdsa",
    "signature": "checkSigEcdsa(signature: sig, public_key: byte[33]) -> bool",
    "params": [
      "signature",
      "public_key"
    ]
  },
  {
    "name": "checkMsgSig",
    "signature": "checkMsgSig(signature: datasig, digest: byte[32], public_key: pubkey) -> bool",
    "params": [
      "signature",
      "digest",
      "public_key"
    ]
  },
  {
    "name": "checkMsgSigEcdsa",
    "signature": "checkMsgSigEcdsa(signature: datasig, digest: byte[32], public_key: byte[33]) -> bool",
    "params": [
      "signature",
      "digest",
      "public_key"
    ]
  },
  {
    "name": "co_spent",
    "signature": "value.co_spent() -> bool",
    "params": []
  },
  {
    "name": "require",
    "signature": "require(condition: bool)",
    "params": [
      "condition"
    ]
  },
  {
    "name": "unrestricted",
    "signature": "unrestricted(output.value)",
    "params": [
      "output.value"
    ]
  },
  {
    "name": "templateHash",
    "signature": "templateHash(templatePrefix: byte[], templateSuffix: byte[]) -> byte[32]",
    "params": [
      "templatePrefix",
      "templateSuffix"
    ]
  },
  {
    "name": "OpSha256",
    "signature": "OpSha256(data)",
    "params": [
      "data"
    ]
  },
  {
    "name": "OpTxSubnetId",
    "signature": "OpTxSubnetId()",
    "params": []
  },
  {
    "name": "OpTxGas",
    "signature": "OpTxGas()",
    "params": []
  },
  {
    "name": "OpTxPayloadLen",
    "signature": "OpTxPayloadLen()",
    "params": []
  },
  {
    "name": "OpTxPayloadSubstr",
    "signature": "OpTxPayloadSubstr(start, length)",
    "params": [
      "start",
      "length"
    ]
  },
  {
    "name": "OpOutpointTxId",
    "signature": "OpOutpointTxId(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpOutpointIndex",
    "signature": "OpOutpointIndex(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpTxInputScriptSigLen",
    "signature": "OpTxInputScriptSigLen(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpTxInputScriptSigSubstr",
    "signature": "OpTxInputScriptSigSubstr(inputIndex, start, length)",
    "params": [
      "inputIndex",
      "start",
      "length"
    ]
  },
  {
    "name": "OpTxInputSeq",
    "signature": "OpTxInputSeq(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpTxInputIsCoinbase",
    "signature": "OpTxInputIsCoinbase(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpTxInputSpkLen",
    "signature": "OpTxInputSpkLen(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpTxInputSpkSubstr",
    "signature": "OpTxInputSpkSubstr(inputIndex, start, length)",
    "params": [
      "inputIndex",
      "start",
      "length"
    ]
  },
  {
    "name": "OpTxOutputSpkLen",
    "signature": "OpTxOutputSpkLen(outputIndex)",
    "params": [
      "outputIndex"
    ]
  },
  {
    "name": "OpTxOutputSpkSubstr",
    "signature": "OpTxOutputSpkSubstr(outputIndex, start, length)",
    "params": [
      "outputIndex",
      "start",
      "length"
    ]
  },
  {
    "name": "OpAuthOutputCount",
    "signature": "OpAuthOutputCount(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpAuthOutputIdx",
    "signature": "OpAuthOutputIdx(inputIndex, outputOrdinal)",
    "params": [
      "inputIndex",
      "outputOrdinal"
    ]
  },
  {
    "name": "OpInputCovenantId",
    "signature": "OpInputCovenantId(inputIndex)",
    "params": [
      "inputIndex"
    ]
  },
  {
    "name": "OpOutputCovenantId",
    "signature": "OpOutputCovenantId(outputIndex)",
    "params": [
      "outputIndex"
    ]
  },
  {
    "name": "OpCovInputCount",
    "signature": "OpCovInputCount(covenantId)",
    "params": [
      "covenantId"
    ]
  },
  {
    "name": "OpCovInputIdx",
    "signature": "OpCovInputIdx(covenantId, inputOrdinal)",
    "params": [
      "covenantId",
      "inputOrdinal"
    ]
  },
  {
    "name": "OpCovOutputCount",
    "signature": "OpCovOutputCount(covenantId)",
    "params": [
      "covenantId"
    ]
  },
  {
    "name": "OpCovOutputIdx",
    "signature": "OpCovOutputIdx(covenantId, outputOrdinal)",
    "params": [
      "covenantId",
      "outputOrdinal"
    ]
  },
  {
    "name": "OpNum2Bin",
    "signature": "OpNum2Bin(value, size)",
    "params": [
      "value",
      "size"
    ]
  },
  {
    "name": "OpBin2Num",
    "signature": "OpBin2Num(data)",
    "params": [
      "data"
    ]
  },
  {
    "name": "OpChainblockSeqCommit",
    "signature": "OpChainblockSeqCommit(blockHash)",
    "params": [
      "blockHash"
    ]
  }
];
