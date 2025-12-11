// is_slice.frag
precision highp float;
precision highp int;

varying vec3 vWorldPos;

uniform float u_z_min;
uniform float u_z_max;
uniform int   u_slice_i;
uniform int   u_slices;
uniform vec3  u_domainMin;
uniform vec3  u_domainMax;

void main() {
    float z0 = u_domainMin.z;
    float z1 = u_domainMax.z;
    float dz = (z1 - z0) / float(u_slices);

    float sliceMin = u_z_min; // JS에서 이미 sliceMin/sliceMax 전달
    float sliceMax = u_z_max;

    if (vWorldPos.z < sliceMin || vWorldPos.z > sliceMax) {
        discard;
    }

    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
