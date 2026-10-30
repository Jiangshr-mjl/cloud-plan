// All app icons are derived from the same vector source and palette.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
const svg=await readFile('public/favicon.svg');
for(const size of [32,192,512])await sharp(svg).resize(size,size).png().toFile(`public/icons/cloud-plan-${size}.png`);
await sharp(svg).resize(180,180).png().toFile('public/apple-touch-icon.png');
const maskable=svg.toString().replace('rx="112"','rx="0"');
await sharp(Buffer.from(maskable)).resize(512,512).png().toFile('public/icons/cloud-plan-maskable-512.png');
const sizes=[16,32,48,64,128,256],images=await Promise.all(sizes.map(size=>sharp(svg).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((size,i)=>{const p=6+i*16;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(images[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=images[i].length;});
await writeFile('public/favicon.ico',Buffer.concat([header,...images]));
console.log('Generated SVG-derived PNG, maskable, Apple, and six-size ICO icons.');
