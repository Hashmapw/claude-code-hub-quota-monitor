import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = path.dirname(fileURLToPath(import.meta.url));

const config = {
  plugins: {
    '@tailwindcss/postcss': {
      base: baseDir,
    },
  },
};

export default config;
