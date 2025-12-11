precision highp float;

varying vec2 v_UV;

void main() {
        // default: -> uv, position built-in from THREE.js geometry
        v_UV        = uv;
        gl_Position = vec4(position, 1.0);
}
