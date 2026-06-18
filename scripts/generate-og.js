'use strict';

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

const outDir = path.join(__dirname, '..', 'client', 'public');
const outFile = path.join(outDir, 'og-cover.png');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <!-- Background -->
  <rect width="1200" height="630" fill="#030712"/>

  <!-- Glow blobs -->
  <ellipse cx="280" cy="90" rx="420" ry="300" fill="#4f46e5" fill-opacity="0.18"/>
  <ellipse cx="950" cy="560" rx="360" ry="240" fill="#7c3aed" fill-opacity="0.13"/>

  <!-- Brand chip -->
  <rect x="80" y="148" width="192" height="40" rx="20" fill="#1e1b4b" stroke="#4f46e5" stroke-opacity="0.5" stroke-width="1.5"/>
  <text x="176" y="174" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="16" font-weight="600" fill="#a5b4fc" text-anchor="middle">chattyio.com</text>

  <!-- Headline -->
  <text x="80" y="285" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="74" font-weight="800" fill="white">Free Anonymous</text>
  <text x="80" y="370" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="74" font-weight="800" fill="#818cf8">Chat.</text>

  <!-- Tagline -->
  <text x="80" y="432" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="26" fill="#6b7280">No account · No logs · Zero data retention</text>

  <!-- Trust pills -->
  <rect x="80" y="496" width="178" height="42" rx="21" fill="#111827" stroke="#374151" stroke-width="1.5"/>
  <text x="169" y="523" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="15" fill="#d1d5db" text-anchor="middle">No account needed</text>

  <rect x="274" y="496" width="136" height="42" rx="21" fill="#111827" stroke="#374151" stroke-width="1.5"/>
  <text x="342" y="523" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="15" fill="#d1d5db" text-anchor="middle">Always free</text>

  <rect x="426" y="496" width="130" height="42" rx="21" fill="#111827" stroke="#374151" stroke-width="1.5"/>
  <text x="491" y="523" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="15" fill="#d1d5db" text-anchor="middle">Worldwide</text>

  <!-- Chat bubble decoration (right side) -->
  <rect x="740" y="148" width="380" height="84" rx="18" fill="#111827" stroke="#1f2937" stroke-width="1.5"/>
  <text x="768" y="185" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="18" fill="#9ca3af">Hey, where are you from?</text>
  <text x="768" y="215" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" fill="#4b5563">Canada · just now</text>

  <rect x="756" y="256" width="364" height="84" rx="18" fill="#312e81" stroke="#3730a3" stroke-width="1.5"/>
  <text x="784" y="293" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="18" fill="#e0e7ff">Nice! I am in London.</text>
  <text x="784" y="323" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" fill="#6366f1">1 min ago</text>

  <rect x="740" y="364" width="310" height="84" rx="18" fill="#111827" stroke="#1f2937" stroke-width="1.5"/>
  <text x="768" y="401" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="18" fill="#9ca3af">This is so cool!</text>
  <text x="768" y="431" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" fill="#4b5563">just now</text>

  <!-- Online dot indicator -->
  <circle cx="1098" cy="190" r="8" fill="#4ade80"/>
  <circle cx="1098" cy="298" r="8" fill="#4ade80"/>
  <circle cx="1098" cy="406" r="8" fill="#4ade80"/>
</svg>`;

fs.mkdirSync(outDir, { recursive: true });

sharp(Buffer.from(svg))
  .png()
  .toFile(outFile)
  .then(() => console.log(`og-cover.png written to ${outFile}`))
  .catch(err => { console.error('Failed to generate og-cover.png:', err); process.exit(1); });
