/** OceanEmbed tokens. The UI stays quiet (paper, ink, one ocean accent) so the data carries the colour.
 *  Values live as CSS variables in src/index.css; Tailwind only names them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: v('paper'),     // page
        wash: v('wash'),       // recessed fill: inputs, hovered rows
        ink: v('ink'),         // primary text
        ink2: v('ink2'),       // body text
        mute: v('mute'),       // secondary text
        faint: v('faint'),     // tertiary text, ticks
        line: v('line'),       // hairlines
        line2: v('line2'),     // stronger hairline, focused controls
        sea: v('sea'),         // the one UI accent: deep ocean teal
        seatint: v('seatint'), // accent fill
        heat: v('heat'),       // alert / threshold (TCHP ≥ 50), used sparingly
        cold: v('cold'),
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['10.5px', { lineHeight: '14px', letterSpacing: '0.06em' }],
      },
      transitionTimingFunction: { out: 'cubic-bezier(.2,.7,.2,1)' },
    },
  },
  plugins: [],
}
