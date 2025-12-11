// xml3D.js
import * as THREE from 'three';
import { XMLSceneParser } from './XMLSceneParser.js';
import {
    PrimitiveType,
    TransformationType,
} from './SceneDataStructures.js';

import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// ---------------- Transformation helpers ----------------

function applyTransformationToMatrix(t, mat) {
    switch (t.type) {
        case TransformationType.TRANSFORMATION_TRANSLATE: {
            const [x, y, z] = t.translate;
            const m = new THREE.Matrix4().makeTranslation(x, y, z);
            mat.multiply(m);
            break;
        }
        case TransformationType.TRANSFORMATION_SCALE: {
            const [x, y, z] = t.scale;
            const m = new THREE.Matrix4().makeScale(x, y, z);
            mat.multiply(m);
            break;
        }
        case TransformationType.TRANSFORMATION_ROTATE: {
            const [x, y, z] = t.rotate;
            const axis = new THREE.Vector3(x, y, z).normalize();
            const m = new THREE.Matrix4().makeRotationAxis(axis, t.angle);
            mat.multiply(m);
            break;
        }
        case TransformationType.TRANSFORMATION_MATRIX: {
            // t.matrix는 row-major 16 float
            const m = new THREE.Matrix4();
            m.fromArray(Array.from(t.matrix));
            mat.multiply(m);
            break;
        }
        default:
            break;
    }
}

function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}

function computeUnlitColorFromMaterial(mat) {
    const d = mat.cDiffuse || { r: 1, g: 1, b: 1, a: 1 };
    const a = mat.cAmbient || { r: 0, g: 0, b: 0, a: 1 };
    const e = mat.cEmissive || { r: 0, g: 0, b: 0, a: 1 };
    const s = mat.cSpecular || { r: 0, g: 0, b: 0, a: 1 };

    const r = clamp01(d.r + 0.3 * a.r + 0.7 * e.r + 0.1 * s.r);
    const g = clamp01(d.g + 0.3 * a.g + 0.7 * e.g + 0.1 * s.g);
    const b = clamp01(d.b + 0.3 * a.b + 0.7 * e.b + 0.1 * s.b);

    return { r, g, b, a: d.a ?? 1.0 };
}

function buildPrimitiveMesh(primitive) {
    let geom;
    switch (primitive.type) {
        case PrimitiveType.SHAPE_CYLINDER:
            geom = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 32);
            break;
        case PrimitiveType.SHAPE_CUBE:
            geom = new THREE.BoxGeometry(1.0, 1.0, 1.0);
            break;
        case PrimitiveType.SHAPE_SPHERE:
            geom = new THREE.SphereGeometry(0.5, 32, 16);
            break;
        case PrimitiveType.SHAPE_CONE:
            geom = new THREE.ConeGeometry(0.5, 1.0, 32);
            break;
        case PrimitiveType.SHAPE_MESH:
            // None
        default:
            geom = null;
    }
    if (!geom) return null;

    const matData = primitive.material || {};
    const c = computeUnlitColorFromMaterial(matData);

    const opacity = ('a' in c) ? c.a : 1.0;
    const transparent = opacity < 0.999;

    const basicMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c.r, c.g, c.b),
        opacity,
        transparent,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, basicMat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
}

function buildThreeFromSceneNode(node, parentMatrix) {
    const group = new THREE.Group();
    const localMatrix = new THREE.Matrix4().copy(parentMatrix);

    for (const t of node.transformations) {
        applyTransformationToMatrix(t, localMatrix);
    }

    for (const prim of node.primitives) {
        const mesh = buildPrimitiveMesh(prim);
        if (!mesh) continue;
        mesh.applyMatrix4(localMatrix);
        group.add(mesh);
    }

    for (const child of node.children) {
        const childGroup = buildThreeFromSceneNode(child, localMatrix);
        group.add(childGroup);
    }

    return group;
}

// ---------------- XML loader ----------------
async function loadXMLSceneAsGroup(url) {
    const res = await fetch(url);
    const text = await res.text();

    const parser = new XMLSceneParser();
    const ok = await parser.parseFromString(text);
    if (!ok) {
        throw new Error('Failed to parse XML scene');
    }

    const root = parser.getRootNode();
    if (!root) {
        throw new Error('No root node in scene');
    }

    const identity = new THREE.Matrix4();
    const group = buildThreeFromSceneNode(root, identity);
    return group;
}

// ---------------- PLY loader ----------------

async function loadPLYAsGroup(url) {
    return new Promise((resolve, reject) => {
        const loader = new PLYLoader();
        loader.load(
            url,
            (geometry) => {
                if (!geometry) {
                    reject(new Error('PLYLoader: geometry is null'));
                    return;
                }
                // PLY에는 노멀 없을 수 있으므로 생성
                geometry.computeVertexNormals();

                const mat = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    wireframe: false,
                    side: THREE.DoubleSide,
                });

                const mesh = new THREE.Mesh(geometry, mat);
                const group = new THREE.Group();
                group.add(mesh);
                resolve(group);
            },
            undefined,
            (err) => reject(err)
        );
    });
}

// ---------------- OBJ loader ----------------

async function loadOBJAsGroup(url) {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (obj) => {
                // OBJ는 material이 포함될 수 있지만,
                // obstacle/디버그용으로 unlit 색으로 강제해도 됨
                obj.traverse((child) => {
                    if (child.isMesh) {
                        if (!child.material || !(child.material instanceof THREE.MeshBasicMaterial)) {
                            child.material = new THREE.MeshBasicMaterial({
                                color: 0xffffff,
                                side: THREE.DoubleSide,
                            });
                        } else {
                            child.material.side = THREE.DoubleSide;
                        }
                    }
                });
                resolve(obj);
            },
            undefined,
            (err) => reject(err)
        );
    });
}

// ---------------- Public API ----------------

/**
 * XML / PLY / OBJ 파일을 공통 인터페이스로 로드.
 *
 * @param {string} url  - .xml / .ply / .obj 또는 blob: URL
 * @param {string} [typeHint] - (선택) 'xml' | 'ply' | 'obj' 등 힌트 문자열
 * @returns {Promise<THREE.Group>} meshGroup
 */
export async function loadXMLModelOnly(url, typeHint = null) {
    // typeHint를 우선 사용하고, 없으면 URL에서 유추
    let id = (typeHint || url || '').toLowerCase();

    const tryXML = async () => {
        const g = await loadXMLSceneAsGroup(url);
        console.log('[loadXMLModelOnly] Loaded as XML scene');
        return g;
    };
    const tryPLY = async () => {
        const g = await loadPLYAsGroup(url);
        console.log('[loadXMLModelOnly] Loaded as PLY mesh');
        return g;
    };
    const tryOBJ = async () => {
        const g = await loadOBJAsGroup(url);
        console.log('[loadXMLModelOnly] Loaded as OBJ mesh');
        return g;
    };

    // 1) typeHint 기반 우선 시도
    if (id === 'xml' || id.endsWith('.xml')) {
        try { return await tryXML(); } catch (e) { console.warn(e); }
    }
    if (id === 'ply' || id.endsWith('.ply')) {
        try { return await tryPLY(); } catch (e) { console.warn(e); }
    }
    if (id === 'obj' || id.endsWith('.obj')) {
        try { return await tryOBJ(); } catch (e) { console.warn(e); }
    }

    // 2) blob: URL 등으로 확장자를 확실히 모를 때 → 순차 fallback
    //    XML → PLY → OBJ
    try { return await tryXML(); } catch (e) { console.warn('[fallback XML failed]', e); }
    try { return await tryPLY(); } catch (e) { console.warn('[fallback PLY failed]', e); }
    try { return await tryOBJ(); } catch (e) { console.warn('[fallback OBJ failed]', e); }

    throw new Error(`Unsupported or unrecognized model format: ${url}`);
}
