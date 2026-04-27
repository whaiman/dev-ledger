import type { DevStats } from "./types.js";

export function generateLanguageChart(stats: DevStats): string {
  const languages = Object.entries(stats.byLanguage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const total = languages.reduce((acc, [_, v]) => acc + v, 0);
  
  if (total === 0) {
    return `<rect width="400" height="40" fill="#f8f9fa" rx="4" />
      <text x="200" y="25" font-family="sans-serif" font-size="14" fill="#6c757d" text-anchor="middle">No activity recorded yet</text>`;
  }

  const width = 400;
  const barHeight = 20;
  const gap = 10;
  const height = languages.length * (barHeight + gap);

  let svg = `<style>
    .label { font: bold 12px sans-serif; fill: #555; }
    .bar { fill: #4CAF50; rx: 4; ry: 4; }
    .bg { fill: #f0f0f0; rx: 4; ry: 4; }
  </style>`;

  languages.forEach(([lang, value], i) => {
    const y = i * (barHeight + gap);
    const percentage = value / total;
    const barWidth = (width - 100) * percentage;

    svg += `<rect class="bg" x="80" y="${y}" width="${width - 100}" height="${barHeight}" />`;
    svg += `<rect class="bar" x="80" y="${y}" width="${barWidth}" height="${barHeight}" />`;
    svg += `<text class="label" x="0" y="${y + 15}">${lang}</text>`;
    svg += `<text class="label" x="${width - 15}" y="${y + 15}" text-anchor="end">${Math.round(percentage * 100)}%</text>`;
  });

  return svg;
}

export function generateActivityHeatmap(stats: DevStats): string {
  const hours = Object.values(stats.byHour);
  const max = Math.max(...hours, 1);
  const width = 400;
  const height = 60;
  const barWidth = width / 24;

  let svg = `<rect width="${width}" height="${height}" fill="#f8f9fa" rx="4" />`;
  
  hours.forEach((value, h) => {
    const barHeight = (value / max) * (height - 10);
    const opacity = 0.3 + (value / max) * 0.7;
    const color = value > 0 ? `rgba(76, 175, 80, ${opacity})` : "#eee";
    svg += `<rect x="${h * barWidth}" y="${height - barHeight}" width="${barWidth - 1}" height="${barHeight}" fill="${color}" rx="1" />`;
  });

  svg += `<text x="2" y="10" font-family="sans-serif" font-size="8" fill="#999">00:00</text>`;
  svg += `<text x="${width - 2}" y="10" font-family="sans-serif" font-size="8" fill="#999" text-anchor="end">23:59</text>`;
  return svg;
}

export function generateCharts(stats: DevStats): string {
  const langChart = generateLanguageChart(stats);
  const hourChart = generateActivityHeatmap(stats);

  return `<svg width="400" height="240" viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="15" font-family="sans-serif" font-size="12" font-weight="bold" fill="#333">Activity by Hour (Last Session)</text>
    <g transform="translate(0, 25)">
      ${hourChart}
    </g>
    <text x="0" y="115" font-family="sans-serif" font-size="12" font-weight="bold" fill="#333">Language Distribution</text>
    <g transform="translate(0, 125)">
      ${langChart}
    </g>
  </svg>`;
}
