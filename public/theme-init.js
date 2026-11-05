(() => {
  let preference = 'system';
  try { preference = localStorage.getItem('dd-appearance') || 'system'; } catch {}
  const theme = preference === 'light' || preference === 'dark' ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  let visual = {};
  try { visual = JSON.parse(localStorage.getItem('cirro-visual-preferences') || '{}') || {}; } catch {}
  const colours = {blue:['#087cf0','#66aaff'],violet:['#7450d8','#b29aff'],teal:['#087f7a','#65d5ca'],rose:['#c54474','#ff94b9'],amber:['#a86006','#efbb65']};
  const accent = Object.hasOwn(colours,visual.accent) ? visual.accent : 'blue';
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.motion = visual.motion === 'reduced' ? 'reduced' : 'system';
  document.documentElement.dataset.transparency = visual.reduceTransparency === true ? 'reduced' : 'full';
  document.documentElement.style.setProperty('--accent',colours[accent][theme === 'dark' ? 1 : 0]);
  document.documentElement.style.setProperty('--accent-solid',colours[accent][0]);
  document.documentElement.style.setProperty('--surface-hover',`color-mix(in srgb, ${colours[accent][theme === 'dark' ? 1 : 0]} ${theme === 'dark' ? '15' : '9'}%, ${theme === 'dark' ? '#20242c' : '#ffffff'})`);
})();
