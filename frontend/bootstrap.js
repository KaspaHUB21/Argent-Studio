const detached=new URLSearchParams(location.search).get('window')==='structure';
if(detached)import('./detached-structure.js');else import('./main.js');
