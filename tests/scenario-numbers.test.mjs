import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScenario,parseValue,stringifyScenario,diagnoseFailure} from '../frontend/transactions.js';

test('integer decimal and exponent notation survives typed and expert JSON roundtrips exactly',()=>{
 for(const [literal,canonical] of [
  ['9007199254740993e0','9007199254740993'],
  ['9007199254740993.0','9007199254740993'],
  ['9.007199254740993e15','9007199254740993'],
  ['900719925474099300e-2','9007199254740993'],
  ['9223372036854775807.000','9223372036854775807'],
  ['9.223372036854775807E+18','9223372036854775807'],
  ['-9223372036854775808e0','-9223372036854775808'],
  ['-9.223372036854775808e18','-9223372036854775808']
 ]){
  assert.equal(stringifyScenario(parseValue(literal,{kind:'int'})),canonical,literal);
  const json='{"version":1,"inputs":[{"state":{"n":'+literal+'},"args":['+literal+']}],"outputs":[]}';
  const expected=json.replaceAll(literal,canonical);
  assert.equal(stringifyScenario(parseScenario(json)),expected,literal);
  assert.equal(stringifyScenario(parseScenario(stringifyScenario(parseScenario(json)))),expected);
 }
});

test('typed integer bounds apply equally to decimal and exponent notation',()=>{
 for(const kind of ['int','temporal'])for(const token of ['9223372036854775808.0','-9223372036854775809e0','1e1000000','1e-1000000','1.00000000000000001','9007199254740993.1'])assert.throws(()=>parseValue(token,{kind}),token);
 assert.equal(parseValue('2.55e2',{kind:'byte'}),255);
 assert.throws(()=>parseValue('2.56e2',{kind:'byte'}));
 assert.throws(()=>parseValue('-1e0',{kind:'byte'}));
 for(const token of ['42','42.0','4.2e1'])assert.equal(parseValue(token,{kind:'int'}),42);
});

test('unsafe fractions and extreme exponents never silently round or become null',()=>{
 for(const token of ['9007199254740993.1','0.000000000000000000000000000000000000000000000000000000000001234567890123456789','1e1000000','1e-1000000'])assert.equal(stringifyScenario(parseScenario(token)),token);
 assert.equal(parseScenario('0e1000000'),0);
 assert.equal(parseScenario('1.25'),1.25);
});

test('diagnosis skips noninteger lossless tokens without throwing',async()=>{
 const scenario=parseScenario('{"inputs":[{"actor":"A","entry":"go"}],"outputs":[{"actor":"A","state":{"fraction":1.00000000000000001,"extreme":1e1000000}}]}');
 let calls=0;
 const result=await diagnoseFailure(async()=>{calls++;return {status:'failed'};},scenario,{status:'failed',input:0});
 assert.equal(calls,0);
 assert.equal(result.status,'failed');
});
