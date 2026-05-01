// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plotly.js-basic-dist ships no TS types
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';

/**
 * Plot = react-plotly.js wrapper around the minimal "basic" plotly build
 * (scatter/line/bar only — enough for our charts and ~60% smaller than
 * plotly.js-dist-min).
 */
export const Plot = createPlotlyComponent(Plotly);
