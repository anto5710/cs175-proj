import { FluidRenderer } from './src/render.js';
import { Controls } from './src/controls.js';

const canvas = document.getElementById('glcanvas');
const simulator = new FluidRenderer(canvas);
simulator.start();

// Attach all buttons/UI listeners
const _controls = new Controls(canvas, simulator);