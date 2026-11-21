
import Application from './javascript/Application.js'

window.application = new Application({
    $canvas: document.querySelector('.js-canvas'),
    useComposer: true
})

// Relax Hub: adaptive quality (see relax/perf.js)
import { startPerf } from './relax/perf.js'
window.relaxPerf = startPerf(window.application)
