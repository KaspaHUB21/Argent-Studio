// Fit card labels to the space inside the SVG block using actual font metrics.
let measureContext;
export function cardLabelLines({width,height,title,subtitle='',code=false}){
 measureContext ||= document.createElement('canvas').getContext('2d');
 const family=code?'Consolas, Menlo, monospace':'Segoe UI, sans-serif',weight=code?500:600;
 const availableWidth=Math.max(20,width-28),availableHeight=Math.max(20,height-18);
 function measure(text,size,font=family,w=weight){measureContext.font=`${w} ${size}px ${font}`;return measureContext.measureText(text).width;}
 function wrap(value,size){const result=[];let line='';for(const char of String(value).replace(/\s+/g,' ').trim()){if(line&&measure(line+char,size)>availableWidth){const split=line.lastIndexOf(' ');if(split>line.length/2){result.push(line.slice(0,split));line=line.slice(split+1)+char;}else{result.push(line);line=char.trimStart();}}else line+=char;}if(line)result.push(line);return result;}
 function ellipsis(text,size,font=family,w=weight){if(measure(text,size,font,w)<=availableWidth)return text;while(text&&measure(text+'…',size,font,w)>availableWidth)text=text.slice(0,-1);return text+'…';}
 const secondary=code?'':String(subtitle).replace(/\s+/g,' ').trim();let size=code?20:22,lines;
 for(;size>=14;size--){lines=wrap(title,size);if(lines.length<=(code?3:2)&&lines.length*size*1.2+(secondary?18:0)<=availableHeight)break;}
 size=Math.max(14,size);lines=wrap(title,size);const limit=Math.max(1,Math.min(code?3:2,Math.floor((availableHeight-(secondary?18:0))/(size*1.2))));
 if(lines.length>limit){lines=lines.slice(0,limit);lines[limit-1]=ellipsis(lines[limit-1]+'…',size);}
 const total=lines.length*size*1.2+(secondary?18:0),top=(height-total)/2;
 const result=lines.map((text,i)=>({text,x:14,y:top+size+i*size*1.2,size,family,weight}));
 if(secondary)result.push({text:ellipsis(secondary,14,'Segoe UI, sans-serif',400),x:14,y:top+lines.length*size*1.2+14,size:14,family:'Segoe UI, sans-serif',weight:400});
 return result;
}
