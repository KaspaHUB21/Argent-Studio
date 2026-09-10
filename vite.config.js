import { defineConfig } from 'vite';
export default defineConfig({
 clearScreen:false,
 server:{host:'127.0.0.1',port:1420,strictPort:true,watch:{ignored:[
  '**/src-tauri/**','**/.runtime-target/**','**/.cargo/**','**/resources/bin/**',
  '**/projects/**','**/test-output/**','**/test-results/**','**/qa/**','**/release/**'
 ]}},
 build:{target:'es2021'}
});
