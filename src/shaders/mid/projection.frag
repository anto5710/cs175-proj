precision highp float;

uniform sampler2D u_velocity_map2;
uniform sampler2D u_pressure_map2;
uniform sampler2D u_is_obstacle_map2;
uniform vec2      u_cell_size;
varying vec2      v_UV;

void main() {
        // We saved (if inside obj) as 1. or 0.
        float is_inside_obj = texture2D(u_is_obstacle_map2, v_UV).r;

        if (is_inside_obj > 0.5) {
                gl_FragColor = vec4(0.);  // color obstacle as black
                return;
        }

        // Calculate pressure at left / right / up / down cells
        float pressure_L = texture2D(u_pressure_map2, v_UV + vec2(-1.,  0.) * u_cell_size).r;
        float pressure_R = texture2D(u_pressure_map2, v_UV + vec2(+1.,  0.) * u_cell_size).r;
        float pressure_U = texture2D(u_pressure_map2, v_UV + vec2( 0., +1.) * u_cell_size).r;
        float pressure_D = texture2D(u_pressure_map2, v_UV + vec2( 0., -1.) * u_cell_size).r;

        // v_new = v* - ∇p
        vec2 vel    = texture2D(u_velocity_map2, v_UV).xy;
        vec2 gradP  = vec2(pressure_R - pressure_L, pressure_U - pressure_D) / 2.;
             vel   -= gradP;

        gl_FragColor = vec4(vel, 0., 1.);
}