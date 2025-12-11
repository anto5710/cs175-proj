precision highp float;

varying float v_z_world;
uniform float u_z_min;
uniform float u_z_max;

uniform int   u_slice_i;
uniform int   u_slices;

void main() {
        float slice_width        = (u_z_max - u_z_min) / float(u_slices);
        float cur_slice_dz_start = u_z_min + float(u_slice_i + 0) * slice_width;
        float cur_slice_dz_end   = u_z_min + float(u_slice_i + 1) * slice_width;

        float is_inside_slice = step(cur_slice_dz_start, v_z_world) * step(v_z_world, cur_slice_dz_end);
        if (is_inside_slice < 0.5) {
                gl_FragColor = vec4(0.);
        } else {
                gl_FragColor = vec4(1., 0., 0., 1.);
        }
}
