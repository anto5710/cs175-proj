precision highp float;

uniform sampler2D u_velocity_map2;
uniform vec2      u_cell_size;
varying vec2      v_UV;

void main() {
        vec2 vel = texture2D(u_velocity_map2, v_UV).xy;

        // Input 80% rightward(->) force(wind) into left 10% of screen
        if (v_UV.x < 0.12) {
                vel = mix(vel, vec2(20., 0.), 0.8);
        }
        gl_FragColor = vec4(vel, 0., 1.);
}