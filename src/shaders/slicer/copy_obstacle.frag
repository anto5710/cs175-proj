// copy_obstacle.frag
precision highp float;

uniform sampler2D u_src;

varying vec2 v_UV;

void main() {
    gl_FragColor = texture2D(u_src, v_UV);
}
