precision highp float;

uniform sampler2D u_field_map;
uniform sampler2D u_velocity_map2;
uniform vec2      u_cell_size;
uniform float     u_dtime;
uniform float     u_dissipate;

varying vec2 v_UV;

// Trace back UV coord 'dtime' ago (on given field) and retrieve value
void main() {
    vec2 vel        = 5. * texture2D(u_velocity_map2, v_UV).xy;
    vec2 prev_coord = v_UV - u_dtime * vel * u_cell_size;
         prev_coord = clamp(prev_coord, 0., 1.);

    vec4 prev_val = texture2D(u_field_map, prev_coord);
    gl_FragColor  = prev_val * u_dissipate;
}