/** Offline mock for next/font Google fetches during build (no outbound fonts.googleapis.com). */
const css = (family) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:local('Arial');}`;

module.exports = new Proxy(
  {},
  {
    get(_t, url) {
      if (typeof url !== 'string') return undefined;
      if (url.includes('Geist+Mono') || url.includes('Geist Mono')) return css('Geist Mono');
      return css('Geist');
    },
  }
);
