import test from 'node:test';
import assert from 'node:assert/strict';
import {localizeError} from '../frontend/errors-i18n.js';
test('application errors follow selected language and support Error objects',()=>{
 assert.equal(localizeError(new Error('Enter an API key in Settings first'),'de'),'Bitte zuerst einen API-Schlüssel in den Einstellungen eingeben.');
 assert.equal(localizeError('An operation is already running','en'),'An operation is already running');
 assert.equal(localizeError(localizeError('Scenario exceeds 4 MB','de'),'en'),'Scenario exceeds 4 MB');
});
test('raw diagnostics and paths remain verbatim in either language',()=>{
 for(const language of ['de','en'])for(const message of ['OpenAI HTTP 400: invalid argument','C:\\projects\\Unknown example.ag:12: parser error','os error 2: cannot find file','Build failed: Unknown example'])assert.equal(localizeError(message,language),message);
});

test('AI scoped-read privacy errors translate in both languages',()=>{
 const english='Linked project paths are unsupported for AI access';
 const german='Die KI darf nicht auf verknüpfte Projektpfade zugreifen.';
 assert.equal(localizeError(english,'de'),german);
 assert.equal(localizeError(german,'en'),english);
 assert.equal(localizeError('AI access requires a source or build file','de'),'Die KI darf nur auf Quell- oder Build-Dateien zugreifen.');
});

test('macOS filesystem errors support both language directions',()=>{
 for(const message of ['Unexpected macOS system alias','Trash requires a regular file']){
  const german=localizeError(message,'de');assert.notEqual(german,message);assert.equal(localizeError(german,'en'),message);
 }
});


test('history and isolated verification errors translate without changing remote diagnostics',()=>{
 for(const message of ['History entry no longer available','Code history snapshot exceeds 640 KB','Verification cancelled','At most 8 verification scenarios are allowed','Isolated verification unavailable.','Mandatory reviewer challenge incomplete; request budget exhausted or reviewer failed.']){
  const german=localizeError(message,'de');assert.notEqual(german,message);assert.equal(localizeError(german,'en'),message);
 }
 for(const message of ['OpenAI HTTP 429: Your account is not active, please check your billing details on our website','tickets.ag:7: parser error','Disk full'])assert.equal(localizeError(message,'de'),message);
});


test('owned diagnostic prefixes retain exact source names and paths',()=>{
 for(const message of ['Source file no longer exists: Transaktion/tickets.ag','Snapshot import is missing: Nachher.ag']){const german=localizeError(message,'de');assert.notEqual(german,message);assert.equal(localizeError(german,'en'),message);assert.ok(german.endsWith(message.split(': ')[1]));}
});
