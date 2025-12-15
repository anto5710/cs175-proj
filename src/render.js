// render.js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadXMLModelOnly as loadModel } from "./loader/xml3D.js";
import { Vector2 as Vec2, Vector3 as Vec3 } from "three";

const DEFAULT_MODEL_PATH = "./data/models/ply/cow.ply";
const SHADER_DIR = "./src/shaders";
const ITER = 15;
const SLICES = 8;
const SIM_RES = 256; // resolution for simulation slice (256 x 256)
const SIM_CELL_SIZE2 = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);
const CAM_ORBIT_SETTINGS = {
  enableDamping: true,
  dampingFactor: 0.6,
  enablePan: false,
  minDistance: 1.0,
  maxDistance: 50.0,
  minPolarAngle: Math.PI * 0.2,
  maxPolarAngle: Math.PI * 0.8,
};

// Voxel collider resolution (PLY -> 3D grid)
const VOX_NUM_X = SIM_RES;
const VOX_NUM_Y = SIM_RES;

const RENDERTARGET_SETUP = {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.FloatType,
  depthBuffer: false,
  stencilBuffer: false,
};

export const ViewModes = {
  VELOCITY: "velocity",
  PRESSURE: "pressure",
  OBSTACLE: "obstacle",
  DYECOLOR: "dye",
};

// A simple ordered pair for ping-pong swapping between current frame & next frame!
class RTPair {
  constructor(RT1, RT2) {
    this.RTs = [RT1, RT2];
    this.cur_i = 0;
    this.next_i = 1;
  }
  swap() {
    [this.cur_i, this.next_i] = [this.next_i, this.cur_i];
  }
  current() {
    return this.RTs[this.cur_i];
  }
  current_texture() {
    return this.RTs[this.cur_i].texture;
  }
  next() {
    return this.RTs[this.next_i];
  }
  next_and_swap() {
    const rt = this.next();
    this.swap();
    return rt;
  }
}

class Slice {
  constructor(res, setup) {
    const make_RT = () => new THREE.WebGLRenderTarget(res, res, setup);

    this.velocity_RTs = new RTPair(make_RT(), make_RT());
    this.pressure_RTs = new RTPair(make_RT(), make_RT());
    this.dyecolor_RTs = new RTPair(make_RT(), make_RT());
    this.divergence_RT = new RTPair(make_RT(), null);
    this.is_obstacle_RT = new RTPair(make_RT(), null);
  }
}

export class FluidRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.is_running = false;
    this.slices = [];

    this.renderer = null;

    this.view_scene = null;
    this.view_cam = null;
    this.sim_scene = null;
    this.sim_cam = null;

    this.obstacle_scene = null;
    this.obstacle_cam = null;
    this.obstacle_group = null;

    this.scoreCallback = null;
    this.currentScore = 0;
    this.displayScore = 0;
    this.obstacleAreaNorm = 0;

    this.sim_mesh = null;
    this.display_mesh = null;
    this.slice_meshes = [];

    this.view_mode = ViewModes.VELOCITY;
    this.display_visible = true;

    this.score = 0.0;
    this.on_score_update = null;

    this._flowback_buffer = new Float32Array(SIM_RES * SIM_RES * 4);
    this._score_sample_total = 0.0;

    // bind methods that are used as callbacks
    this.on_resize = this.on_window_resize.bind(this);
    this._init();
  }

  add_score_listener(l) {
    this.on_score_update = l;
  }

  start() {
    this.is_running = true;
  }
  stop() {
    this.is_running = false;
  }
  isRunning() {
    return this.is_running;
  }

  set_view_mode(mode) {
    this.view_mode = mode;
  }

  // Reset and plays simulation again from t=0
  reset_simulation() {
    if (!this.renderer) return;

    const old_target = this.renderer.getRenderTarget();
    const old_color = this.renderer.getClearColor(new THREE.Color());
    const old_alpha = this.renderer.getClearAlpha();

    this.renderer.setClearColor(0x000000, 0.0);

    // Clear all RT texture's
    for (const slice of this.slices) {
      const rts = [
        slice.velocity_RTs.current(),
        slice.velocity_RTs.next(),
        slice.pressure_RTs.current(),
        slice.pressure_RTs.next(),
        slice.dyecolor_RTs.current(),
        slice.dyecolor_RTs.next(),
        slice.divergence_RT.current(),
      ];
      for (const rt of rts) {
        this.renderer.setRenderTarget(rt);
        this.renderer.clear(true, true, true);
      }
    }

    // Return to previous state before this function run
    this.renderer.setRenderTarget(old_target);
    this.renderer.setClearColor(old_color, old_alpha);

    this.score = 0.0;
    this._score_sample_total = 0.0;
    if (this.on_score_update) this.on_score_update(this.score);
  }

  async loadModel(url, typeHint = null) {
    // Remember current visibility state of display mesh
    const prev_visible = (!this.display_mesh) || this.display_mesh.visible;

    // Remove old display mesh
    if (this.display_mesh && this.view_scene) {
      this.view_scene.remove(this.display_mesh);
      this.display_mesh = null;
    }

    // Remove old obstacle mesh
    if (this.sim_mesh && this.obstacle_group) {
      this.obstacle_group.remove(this.sim_mesh);
    }

    // Load model & Center-Align
    const sim_mesh = await loadModel(url, typeHint);
    this.sim_mesh = sim_mesh;
    sim_mesh.rotation.set(0, 0, 0);
    sim_mesh.updateMatrixWorld(true);

    const bbox0 = new THREE.Box3().setFromObject(sim_mesh);
    const center0 = new THREE.Vector3();
    bbox0.getCenter(center0);
    sim_mesh.position.sub(center0);
    sim_mesh.rotateY(-Math.PI / 2); // By Default Rotate to -90.
    sim_mesh.updateMatrixWorld(true);

    // scale to to fit bounding box
    const size0 = new THREE.Vector3();
    bbox0.getSize(size0);
    const max_abs0 = Math.max(size0.x, size0.y, size0.z, 1.0);
    const scale = 0.8 / max_abs0;
    sim_mesh.scale.setScalar(scale);

    sim_mesh.updateMatrixWorld(true);
    this._update_domain();
    this.sim_mesh.visible = true;

    // Create (dummy) display mesh clone and add to scene
    const display_mesh = this.sim_mesh.clone(true);
    display_mesh.visible = prev_visible;

    this.display_mesh = display_mesh;
    if (this.view_scene) {
      this.view_scene.add(display_mesh);
    }

    if (this.obstacle_scene) {
      this.obstacle_group.add(this.sim_mesh);
      this._update_obstacle_camera();
    } else {
      this._init_obstacle_scene();
    }

    await this._bake_obstacle_gpu_solid();

    this._rebuild_slice_meshes();

    this._camera_to_domain();

    this.score = 0.0;
    this._score_sample_total = 0.0;
    if (this.on_score_update) this.on_score_update(this.score);
  }

  // Called after changing meshGroup transform (rotate, etc)
  async _resetAfterModelTransform() {
    if (!this.sim_mesh) return;

    // Recompute domain from meshGroup
    this._update_domain();

    // Copy transform from meshGroup to displayMesh
    if (this.display_mesh) {
      this.display_mesh.position.copy(this.sim_mesh.position);
      this.display_mesh.quaternion.copy(this.sim_mesh.quaternion);
      this.display_mesh.scale.copy(this.sim_mesh.scale);
      this.display_mesh.updateMatrixWorld(true);
    }

    // Make sure obstacle scene knows about the mesh
    if (!this.obstacle_scene) {
      this._init_obstacle_scene();
    } else {
      if (this.obstacle_group && !this.obstacle_group.children.includes(this.sim_mesh)) {
        this.obstacle_group.add(this.sim_mesh);
      }
      this._update_obstacle_camera();
    }

    // Re-bake obstacle, rebuild slices and refit camera
    await this._bake_obstacle_gpu_solid();
    this._rebuild_slice_meshes();
    this._camera_to_domain();

    // Reset dynamic score
    this.score = 0.0;
    this._score_sample_total = 0.0;
    if (this.on_score_update) this.on_score_update(this.score);
  }
  // Rotate around global X axis by 90 deg * m
  async rotateModel90X(m = +1) {
    if (!this.sim_mesh) return;
    const rad = (Math.PI / 2) * m;
    const axis = new Vec3(1, 0, 0);
    this.sim_mesh.rotateOnWorldAxis(axis, rad);
    await this._resetAfterModelTransform();
  }

  // Rotate around global Y axis by 90 deg * m
  async rotateModel90Y(m = +1) {
    if (!this.sim_mesh) return;
    const rad = (Math.PI / 2) * m;
    const axis = new Vec3(0, 1, 0);
    this.sim_mesh.rotateOnWorldAxis(axis, rad);
    await this._resetAfterModelTransform();
  }

  // Rotate around global Z axis by 90 deg * m
  async rotateModel90Z(m = +1) {
    if (!this.sim_mesh) return;
    const rad = (Math.PI / 2) * m;
    const axis = new Vec3(0, 0, 1);
    this.sim_mesh.rotateOnWorldAxis(axis, rad);
    await this._resetAfterModelTransform();
  }


  on_window_resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (!this.renderer || !this.view_cam) return;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, true);
    this.view_cam.aspect = this._aspect();
    this.view_cam.updateProjectionMatrix();

    // 리사이즈 시에도 카메라 fit 유지
    this._camera_to_domain();
  }

  async load_shader(url) {
    const response = await fetch(`${url}?v=${performance.now()}`);
    return await response.text();
  }

  _generate_shader_material(uniforms_unwrapped, vertexShader, fragmentShader) {
    const uniforms = {};
    for (const key in uniforms_unwrapped) {
      uniforms[key] = { value: uniforms_unwrapped[key] };
    }
    return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  }

  _change_uniform_values(shader, entries_unwrapped) {
    for (const key in entries_unwrapped) {
      shader.uniforms[key].value = entries_unwrapped[key];
    }
  }

  async _init() {
    this._init_rendertargets();
    await this._init_shaders();
    await this._init_scene();
    this._init_animate();

    window.addEventListener("resize", this.on_window_resize);
    this.on_window_resize();
  }

  _aspect() {
    return window.innerWidth / window.innerHeight;
  }

  async _init_scene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
    this.renderer.setClearColor(0x000000, 1.0);

    const FOV = 45;
    const NEAR = 0.1;
    const FAR = 100;

    this.view_scene = new THREE.Scene();
    this.view_cam = new THREE.PerspectiveCamera(FOV, this._aspect(), NEAR, FAR);
    this.view_cam.position.set(0, 0, +5);
    this.view_cam.lookAt(0, 0, 0);

    this.orbit_ctrl = new OrbitControls(
      this.view_cam,
      this.renderer.domElement
    );

    Object.assign(this.orbit_ctrl, CAM_ORBIT_SETTINGS);

    this.orbit_ctrl.target.set(0, 0, 0);
    this.orbit_ctrl.update();

    this.sim_scene = new THREE.Scene();
    this.sim_cam = new THREE.OrthographicCamera(-1, +1, +1, -1, /*near:*/0, /*far:*/1);

    // For simulation, add a 2x2 rectangle
    this.sim_rect_geo = new THREE.PlaneGeometry(2, 2);
    this.sim_rect_mesh = new THREE.Mesh(this.sim_rect_geo, null);
    this.sim_scene.add(this.sim_rect_mesh);

    // Load default model
    await this.loadModel(DEFAULT_MODEL_PATH, "xml");
  }

  _init_obstacle_scene() {
    this.obstacle_scene = new THREE.Scene();

    const min = this.domain_min;
    const max = this.domain_max;
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    // Looking down into -Z:
    this.obstacle_cam = new THREE.OrthographicCamera(
      -size.x * 0.5,
      +size.x * 0.5,
      +size.y * 0.5,
      -size.y * 0.5,
      min.z - 1.0,
      max.z + 1.0
    );
    this.obstacle_cam.position.set(center.x, center.y, max.z + 1.0);
    this.obstacle_cam.lookAt(center);
    this.obstacle_cam.up.set(0, 1, 0);
    this.obstacle_cam.updateProjectionMatrix();
    this.obstacle_scene.add(this.obstacle_cam);

    const obstacleGroup = new THREE.Group();
    if (this.sim_mesh) obstacleGroup.add(this.sim_mesh);
    this.obstacle_scene.add(obstacleGroup);
    this.obstacle_group = obstacleGroup;

    // Temporary RT for 'baking' voxels/is_obstacle boolean map for each slice
    this.obstacleRT = new THREE.WebGLRenderTarget(VOX_NUM_X, VOX_NUM_Y, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  _update_obstacle_camera() {
    if (!this.domain_min || !this.domain_max || !this.obstacle_cam) {
      return;
    }
    const min = this.domain_min;
    const max = this.domain_max;
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    this.obstacle_cam.left = -size.x * 0.5;
    this.obstacle_cam.right = size.x * 0.5;
    this.obstacle_cam.top = size.y * 0.5;
    this.obstacle_cam.bottom = -size.y * 0.5;
    this.obstacle_cam.near = min.z - 1.0;
    this.obstacle_cam.far = max.z + 1.0;

    this.obstacle_cam.position.set(center.x, center.y, max.z + 1.0);
    this.obstacle_cam.lookAt(center);
    this.obstacle_cam.updateProjectionMatrix();
  }

  _rebuild_slice_meshes() {
    if (!this.view_scene) return;

    if (this.slice_meshes) {
      for (const m of this.slice_meshes) {
        this.view_scene.remove(m);
      }
    }

    this._add_slice_meshes();
  }

  // Automatically zooms/fits camera to bonuding box of current mesh model
  _camera_to_domain() {
    if (!this.view_cam || !this.domain_min || !this.domain_max) return;

    const min = this.domain_min;
    const max = this.domain_max;
    const box = new THREE.Box3(min.clone(), max.clone());
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const fov_Y = (this.view_cam.fov * Math.PI) / 180.0;
    const aspect = this._aspect();
    const fov_X = 2.0 * Math.atan(Math.tan(fov_Y * 0.5) * aspect);

    const half_w = size.x * 0.5;
    const half_h = size.y * 0.5;

    const dist_Y = half_h / Math.tan(fov_Y * 0.5);
    const dist_X = half_w / Math.tan(fov_X * 0.5);

    let dist = Math.max(dist_X, dist_Y);
    if (!isFinite(dist) || dist <= 0) dist = 3.0;

    const MARGIN = 1.4;
    let camDist = dist * MARGIN;

    const depth = size.z || 1.0;
    camDist += depth * 0.5;

    const dir = new THREE.Vector3(0, 0, 1);
    this.view_cam.position.copy(center).addScaledVector(dir, camDist);

    this.view_cam.near = Math.max(0.01, camDist - depth * 4.0);
    this.view_cam.far = camDist + depth * 4.0;

    this.view_cam.lookAt(center);
    this.view_cam.updateProjectionMatrix();

    if (this.orbit_ctrl) {
      this.orbit_ctrl.target.copy(center);
      this.orbit_ctrl.update();
    }
  }

  _add_slice_meshes() {
    const min = this.domain_min ?? new THREE.Vector3(-1, -1, -0.5);
    const max = this.domain_max ?? new THREE.Vector3(+1, +1, +0.5);

    const size = new THREE.Vector3().subVectors(max, min); // (dx, dy, dz)
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    this.slice_meshes = [];

    const thickness = size.z !== 0 ? size.z : 0.0001;
    const dz = thickness / SLICES;
    const first_center_z = min.z + dz * 0.5;

    const planeWidth = size.x;
    const planeHeight = size.y;

    for (let i = 0; i < SLICES; i++) {
      const slice_geo = new THREE.PlaneGeometry(planeWidth, planeHeight);
      const slice_mat = new THREE.MeshBasicMaterial({
        map: this.slices[i].dyecolor_RTs.current_texture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        opacity: 0.3,
      });

      const slice_mesh = new THREE.Mesh(slice_geo, slice_mat);

      const z = first_center_z + dz * i;
      slice_mesh.position.set(center.x, center.y, z);

      slice_mesh.renderOrder = i;

      this.slice_meshes.push(slice_mesh);
      this.view_scene.add(slice_mesh);
    }
  }

  _init_animate() {
    this.last_time = performance.now();

    const animate = (now) => {
      requestAnimationFrame(animate);
      const dtime = Math.min((now - this.last_time) / 1000, 1 / 30);
      this.last_time = now;

      if (this.is_running) {
        for (let i = 0; i < SLICES; i++) {
          this._step_simulation_slice(i, dtime);
        }

        this._score_sample_total += dtime;
        const SAMPLE_INTERVAL = 0.25; // sample every 0.25 interval
        if (this._score_sample_total >= SAMPLE_INTERVAL) {
          this._score_sample_total = 0.0;
          this._update_score();
        }
      }

      this.orbit_ctrl.update();
      this.renderer.render(this.view_scene, this.view_cam);
    };
    animate(performance.now());
  }

  _init_rendertargets() {
    for (let i = 0; i < SLICES; i++) {
      this.slices[i] = new Slice(SIM_RES, RENDERTARGET_SETUP);
    }
  }

  async _init_shaders() {
    // Default dummy values
    const velocity_map_init = this.slices[0].velocity_RTs.current_texture();
    const dyecolor_map_init = this.slices[0].dyecolor_RTs.current_texture();
    const is_obstacle_map_init = this.slices[0].is_obstacle_RT.current_texture();

    this.def_vertex_shader = await this.load_shader(`${SHADER_DIR}/mid/default.vert`);
    const { def_vertex_shader } = this;

    const input_force_frag = await this.load_shader(`${SHADER_DIR}/input/input_force.frag`);
    this.input_force_shader = this._generate_shader_material(
      {
        u_velocity_map2: velocity_map_init,
        u_cell_size: SIM_CELL_SIZE2,
      },
      def_vertex_shader, input_force_frag
    );

    const input_dye_frag = await this.load_shader(`${SHADER_DIR}/input/input_dye.frag`);
    this.input_dye_shader = this._generate_shader_material(
      {
        u_dyecolor_map2: dyecolor_map_init,
        u_cell_size: SIM_CELL_SIZE2,
      },
      def_vertex_shader, input_dye_frag
    );

    const advection_frag = await this.load_shader(`${SHADER_DIR}/mid/advection.frag`);
    this.advection_shader = this._generate_shader_material(
      {
        u_field_map: null,
        u_velocity_map2: null,
        u_dtime: 0.016,
        u_cell_size: SIM_CELL_SIZE2,
        u_dissipate: 0.99,
      },
      def_vertex_shader, advection_frag
    );

    const divergence_frag = await this.load_shader(`${SHADER_DIR}/mid/divergence.frag`);
    this.divergence_shader = this._generate_shader_material(
      {
        u_velocity_map2: null,
        u_is_obstacle_map2: is_obstacle_map_init,
        u_cell_size: SIM_CELL_SIZE2,
      },
      def_vertex_shader, divergence_frag
    );

    const pressure_frag = await this.load_shader(`${SHADER_DIR}/mid/pressure.frag`);
    this.pressure_shader = this._generate_shader_material(
      {
        u_pressure_map2: null,
        u_divergence_map2: null,
        u_is_obstacle_map2: is_obstacle_map_init,
        u_cell_size: SIM_CELL_SIZE2,
      },
      def_vertex_shader, pressure_frag
    );

    const projection_frag = await this.load_shader(`${SHADER_DIR}/mid/projection.frag`);
    this.projection_shader = this._generate_shader_material(
      {
        u_velocity_map2: null,
        u_pressure_map2: null,
        u_is_obstacle_map2: is_obstacle_map_init,
        u_cell_size: SIM_CELL_SIZE2,
      },
      def_vertex_shader, projection_frag
    );

    const render_dyecolor_frag = await this.load_shader(`${SHADER_DIR}/output/render_dyecolor.frag`);
    this.render_dyecolor_shader = this._generate_shader_material(
      {
        u_dye_texture: dyecolor_map_init,
      },
      def_vertex_shader, render_dyecolor_frag
    );

    const is_slice_vert = await this.load_shader(`${SHADER_DIR}/slicer/is_slice.vert`);
    const is_slice_frag = await this.load_shader(`${SHADER_DIR}/slicer/is_slice.frag`);
    this.is_slice_shader = this._generate_shader_material(
      {
        u_z_min: 0.0,
        u_z_max: 0.0,
        u_slice_i: 0,
        u_slices: SLICES,
        u_domainMin: new Vec3(0, 0, 0),
        u_domainMax: new Vec3(0, 0, 0),
      },
      is_slice_vert, is_slice_frag
    );

    const copy_obstacle_frag = await this.load_shader(`${SHADER_DIR}/slicer/copy_obstacle.frag`);
    this.copy_obstacle_shader = this._generate_shader_material(
      {
        u_src: null,
      },
      def_vertex_shader, copy_obstacle_frag
    );
  }

  _render_simulation(changed_uniforms, shader, render_target) {
    this.sim_rect_mesh.material = shader;
    this._change_uniform_values(shader, changed_uniforms);
    this.renderer.setRenderTarget(render_target);
    this.renderer.render(this.sim_scene, this.sim_cam);
  }

  async _bake_obstacle_gpu_solid() {
    const min = this.domain_min;
    const max = this.domain_max;

    if (!min || !max || !this.sim_mesh || !this.obstacle_scene) return;

    this.renderer.setClearColor("black", 1.0);

    const thickness = max.z - min.z;
    const dz = thickness / SLICES;

    const w = VOX_NUM_X;
    const h = VOX_NUM_Y;
    const surface_buffer = new Uint8Array(w * h * 4);
    const solid_buffer = new Uint8Array(w * h * 4);

    let totalAreaNorm = 0;

    for (let si = 0; si < SLICES; si++) {
      const cz = min.z + dz * (si + 0.5);
      const slice_start = cz - dz * 0.5;
      const slice_end = cz + dz * 0.5;

      const oldOverride = this.obstacle_scene.overrideMaterial;
      this.obstacle_scene.overrideMaterial = this.is_slice_shader;

      this._change_uniform_values(this.is_slice_shader, {
        u_z_min: slice_start,
        u_z_max: slice_end,
        u_slice_i: si,
        u_slices: SLICES,
        u_domainMin: min,
        u_domainMax: max,
      });

      this.renderer.setRenderTarget(this.obstacleRT);
      this.renderer.clear();
      this.renderer.render(this.obstacle_scene, this.obstacle_cam);

      this.obstacle_scene.overrideMaterial = oldOverride;

      this.renderer.readRenderTargetPixels(
        this.obstacleRT, 0, 0, w, h, surface_buffer
      );

      this._compute_solid_mask(surface_buffer, solid_buffer, w, h);
      let count = 0;
      for (let i = 0; i < w * h; i++) {
        if (solid_buffer[i * 4 + 0] > 0) { // is obstacle
          count++;
        }
      }
      const areaNormSlice = count / (w * h); // 0~1
      totalAreaNorm += areaNormSlice;
      const tex = new THREE.DataTexture(
        solid_buffer, w, h, THREE.RGBAFormat, THREE.UnsignedByteType
      );
      tex.needsUpdate = true;
      tex.minFilter = tex.magFilter = THREE.NearestFilter;

      const rt = this.slices[si].is_obstacle_RT.current();

      this.sim_rect_mesh.material = this.copy_obstacle_shader;
      this._change_uniform_values(this.copy_obstacle_shader, {
        u_src: tex,
      });
      this.renderer.setRenderTarget(rt);
      this.renderer.clear();
      this.renderer.render(this.sim_scene, this.sim_cam);
    }

    this.renderer.setRenderTarget(null);
    this.obstacleAreaNorm = totalAreaNorm / SLICES;

    this._init_score_from_geo();
  }

  _init_score_from_geo() {
    const area = Math.max(this.obstacleAreaNorm, 0);
    const AREA_SCALE = 1.0;
    let score = 1.0 - AREA_SCALE * area;
    score = Math.max(0.0, Math.min(1.0, score));

    this.currentScore = score;
    if (!this.displayScore) {
      this.displayScore = score;
    }
  }

  _update_domain() {
    if (!this.sim_mesh) {
      return;
    }

    this.sim_mesh.updateMatrixWorld(true);

    const domain_bbox = new THREE.Box3().setFromObject(this.sim_mesh);
    const domain_min = domain_bbox.min.clone();
    const domain_max = domain_bbox.max.clone();

    // Expand a bit in x direction
    const sx = 1.6;
    if (sx > 1.0) {
      const dx = domain_max.x - domain_min.x;
      const padX = dx * (sx - 1.0) * 0.5;
      domain_min.x -= padX;
      domain_max.x += padX;
    }

    this.domain_min = domain_min;
    this.domain_max = domain_max;
  }

  // Flood-fill algorithm: https://www.geeksforgeeks.org/dsa/flood-fill-algorithm/
  _compute_solid_mask(surface_buffer, out_buffer, w, h) {
    // surfaceBuffer: RGBA, obstacle surface pixel -> R > 0, ELSE R       == 0
    // outBuffer:     RGBA, inside + surface       -> = 255, ELSE outside == 0

    const N = w * h;
    const outside = new Uint8Array(N); // 0=unknown, 1=outside

    const idx = (x, y) => y * w + x;
    const inBounds = (x, y) => x >= 0 && x < w && y >= 0 && y < h;

    const qx = [];
    const qy = [];

    const push = (x, y) => {
      const i = idx(x, y);
      if (outside[i]) return;

      const r = surface_buffer[i * 4 + 0];
      if (r !== 0) return;

      outside[i] = 1;
      qx.push(x);
      qy.push(y);
    };

    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }

    const dirs = [
      [+1, 0],
      [-1, 0],
      [0, +1],
      [0, -1],
    ];
    while (qx.length > 0) {

      const x = qx.pop();
      const y = qy.pop();

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;

        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);

        if (outside[j]) continue;
        const r = surface_buffer[j * 4 + 0];

        if (r !== 0) continue;

        outside[j] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }

    // outside=0 -> interior or surface -> so martk it as obstacle=1 (255)
    for (let i = 0; i < N; i++) {
      const isOutside = outside[i] === 1;
      const v = isOutside ? 0 : 255;
      const o = i * 4;

      out_buffer[o + 0] = v;
      out_buffer[o + 1] = 0;
      out_buffer[o + 2] = 0;
      out_buffer[o + 3] = 255;
    }
  }

  // Calculate aero score TM using amount of wind arriving on the right wall.
  _update_score() {
    if (!this.renderer || !this.slices.length) return;

    const sample_slice_i = Math.floor(SLICES / 2);
    const slice = this.slices[sample_slice_i];
    const rt = slice.dyecolor_RTs.current();

    const [w, h] = [SIM_RES, SIM_RES];

    const prev_target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);

    try {
      this.renderer.readRenderTargetPixels(
        rt, 0, 0, w, h, this._flowback_buffer
      );
    } catch (e) {
      this.renderer.setRenderTarget(prev_target);
      return;
    }

    this.renderer.setRenderTarget(prev_target);

    const border_width = Math.max(1, Math.floor(w * 0.1));
    const x_start = w - border_width;

    let chroma_sum = 0.0;
    let count = 0;

    const fbuff = this._flowback_buffer;

    for (let y = 0; y < h; y++) {
      for (let x = x_start; x < w; x++) {
        const index = (y * w + x) * 4;
        const [r, g, b] = [fbuff[index + 0], fbuff[index + 1], fbuff[index + 2]];
        // avg choromatic value
        const v = (r + g + b) / 3.0;
        chroma_sum += v;
        count++;
      }
    }

    if (count === 0) {
      return;
    }

    let chroma_avg = chroma_sum / count;
    chroma_avg = Math.max(0.0, Math.min(1.0, chroma_avg));

    const SMOOTH = 0.85;
    this.score = SMOOTH * this.score + (1.0 - SMOOTH) * chroma_avg;

    if (this.on_score_update) {
      this.on_score_update(this.score);
    }
  }

  set_display_visible(is_visible) {
    this.display_visible = is_visible;
    if (this.display_mesh) {
      this.display_mesh.visible = this.display_visible;
    }
  }

  // 'Steps' or ticks the simulation, with delta time (measured system)
  // Inputs windforce / dye, and calculates advection and such
  _step_simulation_slice(i, dtime) {
    const slice = this.slices[i];

    const {
      velocity_RTs,
      dyecolor_RTs,
      divergence_RT,
      pressure_RTs,
      is_obstacle_RT,
    } = slice;
    const {
      input_force_shader,
      input_dye_shader,
      advection_shader,
      divergence_shader,
      pressure_shader,
      projection_shader,
    } = this;

    //=====================================================================
    // 0-a. Input/mix force(wind velocity) into left of canvas
    //=====================================================================
    this._render_simulation(
      {
        u_velocity_map2: velocity_RTs.current_texture(),
      },
      input_force_shader,
      velocity_RTs.next_and_swap()
    );

    //=====================================================================
    // 0-b. Input/mix colored dye into left of canvas
    //=====================================================================
    this._render_simulation(
      {
        u_dyecolor_map2: dyecolor_RTs.current_texture(),
      },
      input_dye_shader,
      dyecolor_RTs.next_and_swap()
    );

    //=====================================================================
    // 1-a. Use advection(flow) to predict/trace propagation of velocity
    //=====================================================================
    this._render_simulation(
      {
        u_field_map: velocity_RTs.current_texture(),
        u_velocity_map2: velocity_RTs.current_texture(),
        u_dtime: dtime,
        u_dissipate: 0.995,
      },
      advection_shader,
      velocity_RTs.next_and_swap()
    );

    //=====================================================================
    // 1-b. Use advection(flow) to predict/trace propagation of dye
    //=====================================================================
    this._render_simulation(
      {
        u_field_map: dyecolor_RTs.current_texture(),
        u_velocity_map2: velocity_RTs.current_texture(),
        u_dtime: dtime,
        u_dissipate: 0.999,
      },
      advection_shader,
      dyecolor_RTs.next_and_swap()
    );

    //=====================================================================
    // 2. Calculate divergence (in/out amount of velocity from each cell)
    //=====================================================================
    this._render_simulation(
      {
        u_velocity_map2: velocity_RTs.current_texture(),
        u_is_obstacle_map2: is_obstacle_RT.current_texture(),
      },
      divergence_shader, divergence_RT.current()
    );

    //=====================================================================
    // 3. Calculate pressure (to offset divergence) by Jacobi process
    //=====================================================================
    this.renderer.setRenderTarget(pressure_RTs.current());
    this.renderer.clear();
    this.sim_rect_mesh.material = pressure_shader;
    this._change_uniform_values(pressure_shader, {
      u_divergence_map2: divergence_RT.current_texture(),
      u_is_obstacle_map2: is_obstacle_RT.current_texture(),
    });

    for (let iter = 0; iter < ITER; iter++) {
      this._change_uniform_values(pressure_shader, {
        u_pressure_map2: pressure_RTs.current_texture(),
      });
      this.renderer.setRenderTarget(pressure_RTs.next_and_swap());
      this.renderer.render(this.sim_scene, this.sim_cam);
    }

    //=====================================================================
    // 4. Calculate projection = new (curved) wind velocity due to pressure
    //=====================================================================
    this._render_simulation(
      {
        u_velocity_map2: velocity_RTs.current_texture(),
        u_pressure_map2: pressure_RTs.current_texture(),
        u_is_obstacle_map2: is_obstacle_RT.current_texture(),
      },
      projection_shader,
      velocity_RTs.next_and_swap()
    );

    //=====================================================================
    // 5. Return & render current field according to viewMode
    //=====================================================================
    this.renderer.setRenderTarget(null);

    let viewTex;
    switch (this.view_mode) {
      case ViewModes.PRESSURE:
        viewTex = pressure_RTs.current_texture();
        break;
      case ViewModes.OBSTACLE:
        viewTex = is_obstacle_RT.current_texture();
        break;
      case ViewModes.DYECOLOR:
        viewTex = dyecolor_RTs.current_texture();
        break;
      case ViewModes.VELOCITY:
      default:
        viewTex = velocity_RTs.current_texture();
        break;
    }

    // small safety guard against undefined meshes
    const sliceMesh = this.slice_meshes[i];
    if (!sliceMesh || !sliceMesh.material) return;

    sliceMesh.material.map = viewTex;
    sliceMesh.material.needsUpdate = true;
  }
}
