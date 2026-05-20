import * as fs from 'node:fs';
import * as path from 'node:path';
import * as progress from 'cli-progress';
import { imageDescription } from '../src/agent/imageDescription';

(async () => {
  const imageTests: { path: string; image: Buffer; outputs: string }[] = [];

  // Read all directories
  const allFiles = fs.readdirSync(__dirname);
  for (const f of allFiles) {
    if (fs.statSync(path.join(__dirname, f)).isDirectory()) {
      console.log(`Run series ${f}`);
      const files = fs.readdirSync(path.join(__dirname, f));
      for (const s of files) {
        if (s.endsWith('.jpeg')) {
          const image = fs.readFileSync(path.join(__dirname, f, s));
          imageTests.push({
            path: path.join(__dirname, f, s).replace('.jpeg', '.md'),
            image,
            outputs: '',
          });
        }
      }
    }
  }

  async function runTest(title: string, test: (img: Uint8Array) => Promise<string>) {
    console.log(`Run ${title}`);
    const bar = new progress.SingleBar({}, progress.Presets.shades_classic);
    bar.start(imageTests.length, 0);
    for (let i = 0; i < imageTests.length; i++) {
      const o = await test(imageTests[i].image);
      imageTests[i].outputs += `####${title}####\n`;
      imageTests[i].outputs += `${o}\n`;
      bar.increment();
    }
    bar.stop();
  }

  // Run tests
  await runTest('Description', async (img) => {
    return await imageDescription(img);
  });

  // console.log(`Run blurry tests`);
  // for (let i of imageTests) {
  //     i.outputs += '####Blurry####\n';
  //     i.outputs += await imageBlurry(i.image) + '\n';
  // }

  // Write outputs
  for (const i of imageTests) {
    fs.writeFileSync(i.path, i.outputs);
  }
})();
