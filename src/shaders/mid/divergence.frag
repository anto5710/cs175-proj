precision highp float;

uniform sampler2D u_velocity_map2;
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

        // Calculate wind velocities at left / right / up / down cells
        vec2 vel_L = texture2D(u_velocity_map2, v_UV + vec2(-1.,  0.) * u_cell_size).xy;
        vec2 vel_R = texture2D(u_velocity_map2, v_UV + vec2(+1.,  0.) * u_cell_size).xy;
        vec2 vel_U = texture2D(u_velocity_map2, v_UV + vec2( 0., +1.) * u_cell_size).xy;
        vec2 vel_D = texture2D(u_velocity_map2, v_UV + vec2( 0., -1.) * u_cell_size).xy;

        // Assuming h=1
        float divergence   = ((vel_R.x - vel_L.x) + (vel_U.y - vel_D.y)) / 2.;
        gl_FragColor = vec4(divergence, 0., 0., 1.);
}