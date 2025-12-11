precision highp float;

uniform sampler2D u_dye_texture;
varying vec2      v_UV;

void main() {
        vec3 color   = texture2D(u_dye_texture, v_UV).rgb;
        gl_FragColor = vec4(color, 1.0);
}