// is_obstacle.frag

precision highp float;

uniform vec3 u_domain_min;
uniform vec3 u_domain_max;

uniform int  u_slice_i;
uniform int  u_slices;

const int MAX_PRIMS = 32;

// cylinder 전용 analytic obstacle
uniform int   u_prim_count;
uniform vec3  u_prim_center[MAX_PRIMS];
uniform vec3  u_prim_axis[MAX_PRIMS];       // normalized
uniform float u_prim_halfHeight[MAX_PRIMS];
uniform float u_prim_radius[MAX_PRIMS];

varying vec2 v_UV;

float sliceZ() {
    float denom = float(max(u_slices - 1, 1));
    float zf = float(u_slice_i) / denom;
    return mix(u_domain_min.z, u_domain_max.z, zf);
}

void main() {
    float x = mix(u_domain_min.x, u_domain_max.x, v_UV.x);
    float y = mix(u_domain_min.y, u_domain_max.y, v_UV.y);
    float z = sliceZ();
    vec3 p = vec3(x, y, z);

    float occ = 0.0;

    for (int i = 0; i < MAX_PRIMS; ++i) {
        if (i >= u_prim_count) break;

        vec3  c  = u_prim_center[i];
        vec3  ax = u_prim_axis[i];
        float hh = u_prim_halfHeight[i];
        float r  = u_prim_radius[i];

        vec3 d = p - c;
        float h = dot(d, ax);            // 축 방향 위치

        if (abs(h) > hh) {
            continue;
        }

        vec3 radial = d - h * ax;
        float dist = length(radial);
        if (dist <= r) {
            occ = 1.0;
            break;
        }
    }

    gl_FragColor = vec4(occ, 0.0, 0.0, 1.0);
}
