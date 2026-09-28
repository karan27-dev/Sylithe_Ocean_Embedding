/** Sylithe design tokens (scraped from ~/Desktop/sylithe/Frontend) applied to OceanEmbed. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',        // sylitheDark — primary text
        paper: '#F1F1F1',      // app background
        abyss: '#08292F',      // deep teal — rail / hero panels
        trench: '#062125',     // darker teal — rail hover / map frame
        leaf: '#16a34a',       // primary accent
        mint: '#a4fca1',       // highlight on dark
        lime: '#A3E635',       // sylitheGreen
        mist: '#EBF1ED',       // tinted card
      },
      fontFamily: {
        sans: ['Space Grotesk', 'DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
