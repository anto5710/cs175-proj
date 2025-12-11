precision highp float;

uniform sampler2D u_dyecolor_map2;
uniform vec2      u_cell_size;
varying vec2      v_UV;

void main() {
        vec3 dyecolor = texture2D(u_dyecolor_map2, v_UV).rgb;

        // Input 30% dye into left 10% of screen
        if (v_UV.x < 0.12) {
                dyecolor = mix(dyecolor, vec3(0.9, 0.7, 0.3), 0.3);
        }
        gl_FragColor = vec4(dyecolor, 1.);
}