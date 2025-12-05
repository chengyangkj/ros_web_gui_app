import * as THREE from 'three';
import type { RosbridgeConnection } from './RosbridgeConnection';

export interface TransformStamped {
  header: {
    frame_id: string;
    stamp: {
      sec: number;
      nsec: number;
    };
  };
  child_frame_id: string;
  transform: {
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  };
}

interface Transform {
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
}

type TransformChangeCallback = () => void;

class Frame {
  public id: string;
  public parent: Frame | null = null;
  public children: Frame[] = [];
  private transformToParent: Transform | null = null;

  constructor(id: string) {
    this.id = id;
  }

  setParent(parent: Frame, transform: Transform): void {
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index > -1) {
        this.parent.children.splice(index, 1);
      }
    }
    this.parent = parent;
    this.transformToParent = transform;
    parent.children.push(this);
  }

  getTransformToParent(): Transform | null {
    return this.transformToParent;
  }
}

export class TF2JS {
  private static instance: TF2JS | null = null;
  private frames: Map<string, Frame> = new Map();
  private rootFrame: Frame | null = null;
  private changeCallbacks: Set<TransformChangeCallback> = new Set();
  private connection: RosbridgeConnection | null = null;
  private tfUnsubscribe: (() => void) | null = null;
  private tfStaticUnsubscribe: (() => void) | null = null;

  private constructor() {}

  public getFrames(): string[] {
    return Array.from(this.frames.keys());
  }

  public static getInstance(): TF2JS {
    if (!TF2JS.instance) {
      TF2JS.instance = new TF2JS();
    }
    return TF2JS.instance;
  }

  public initialize(connection: RosbridgeConnection): void {
    if (this.connection === connection) {
      return;
    }

    if (this.connection && this.connection !== connection) {
      if (this.tfUnsubscribe) {
        this.tfUnsubscribe();
        this.tfUnsubscribe = null;
      }
      if (this.tfStaticUnsubscribe) {
        this.tfStaticUnsubscribe();
        this.tfStaticUnsubscribe = null;
      }
    }

    this.connection = connection;

    if (!connection.isConnected()) {
      return;
    }

    const tfCallback = (message: unknown) => {
      const msg = message as { transforms?: TransformStamped[] };
      if (msg.transforms && Array.isArray(msg.transforms)) {
        this.addTransforms(msg.transforms);
      }
    };

    const tfStaticCallback = (message: unknown) => {
      const msg = message as { transforms?: TransformStamped[] };
      if (msg.transforms && Array.isArray(msg.transforms)) {
        this.addTransforms(msg.transforms);
      }
    };

    const tfType = connection.getTopicType('/tf') || 'tf2_msgs/TFMessage';
    const tfStaticType = connection.getTopicType('/tf_static') || 'tf2_msgs/TFMessage';

    try {
      connection.subscribe('/tf', tfType, tfCallback);
      this.tfUnsubscribe = () => connection.unsubscribe('/tf');
    } catch (error) {
      console.error('[TF2JS] Failed to subscribe to /tf:', error);
    }

    try {
      connection.subscribe('/tf_static', tfStaticType, tfStaticCallback);
      this.tfStaticUnsubscribe = () => connection.unsubscribe('/tf_static');
    } catch (error) {
      console.error('[TF2JS] Failed to subscribe to /tf_static:', error);
    }
  }

  public disconnect(): void {
    if (this.tfUnsubscribe) {
      this.tfUnsubscribe();
      this.tfUnsubscribe = null;
    }
    if (this.tfStaticUnsubscribe) {
      this.tfStaticUnsubscribe();
      this.tfStaticUnsubscribe = null;
    }
    this.connection = null;
    this.clear();
  }

  public onTransformChange(callback: TransformChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      callback();
    }
  }

  private getOrCreateFrame(frameId: string): Frame {
    let frame = this.frames.get(frameId);
    if (!frame) {
      frame = new Frame(frameId);
      this.frames.set(frameId, frame);
      if (!this.rootFrame) {
        this.rootFrame = frame;
      }
    }
    return frame;
  }

  private addTransform(transformStamped: TransformStamped): void {
    const parentFrameId = transformStamped.header.frame_id;
    const childFrameId = transformStamped.child_frame_id;
    const t = transformStamped.transform.translation;
    const r = transformStamped.transform.rotation;

    const parentFrame = this.getOrCreateFrame(parentFrameId);
    const childFrame = this.getOrCreateFrame(childFrameId);

    const transform: Transform = {
      translation: new THREE.Vector3(t.x, t.y, t.z),
      rotation: new THREE.Quaternion(r.x, r.y, r.z, r.w),
    };

    childFrame.setParent(parentFrame, transform);

    if (this.rootFrame === childFrame) {
      this.rootFrame = parentFrame;
    }
  }

  public addTransforms(transforms: TransformStamped[]): void {
    let changed = false;
    for (const transform of transforms) {
      this.addTransform(transform);
      changed = true;
    }
    if (changed) {
      this.notifyChange();
    }
  }

  public findTransform(targetFrame: string, sourceFrame: string): Transform | null {
    const target = this.frames.get(targetFrame);
    const source = this.frames.get(sourceFrame);

    if (!target || !source) {
      return null;
    }

    const pathToRoot: Frame[] = [];
    let current: Frame | null = source;
    while (current) {
      pathToRoot.push(current);
      current = current.parent;
    }

    const targetPath: Frame[] = [];
    current = target;
    while (current) {
      targetPath.push(current);
      current = current.parent;
    }

    const commonAncestor = pathToRoot.find((frame) => targetPath.includes(frame));
    if (!commonAncestor) {
      return null;
    }

    const sourceToCommon: Transform[] = [];
    current = source;
    while (current && current !== commonAncestor) {
      const transform = current.getTransformToParent();
      if (transform) {
        sourceToCommon.push(transform);
      }
      current = current.parent;
    }

    const commonToTarget: Transform[] = [];
    current = target;
    while (current && current !== commonAncestor) {
      const transform = current.getTransformToParent();
      if (transform) {
        commonToTarget.unshift(transform);
      }
      current = current.parent;
    }

    // Build transform from source to target
    // Following suite-base's approach: GetTransformMatrix computes parent_T_child
    // We need source_T_target, which is computed as:
    // source -> commonAncestor -> target
    // = (source -> commonAncestor) * (commonAncestor -> target)
    // = (source -> commonAncestor) * inverse(target -> commonAncestor)
    
    // Start with identity matrix
    let resultTransform = new THREE.Matrix4().identity();

    // Step 1: Build transform from source to common ancestor
    // Apply transforms from source upward to common ancestor
    // Each transform is child_T_parent, so we multiply left-to-right
    for (const transform of sourceToCommon) {
      const matrix = new THREE.Matrix4();
      matrix.makeRotationFromQuaternion(transform.rotation);
      matrix.setPosition(transform.translation);
      // Left multiply: result = matrix * result (like suite-base's mat4.multiply)
      const temp = new THREE.Matrix4();
      temp.multiplyMatrices(matrix, resultTransform);
      resultTransform = temp;
    }

    // Step 2: Build transform from commonAncestor to target
    // commonToTarget contains transforms from target -> parent -> ... -> commonAncestor
    // We need commonAncestor -> target, so we invert each transform
    // Then apply them in reverse order (from commonAncestor to target)
    for (let i = commonToTarget.length - 1; i >= 0; i--) {
      const transform = commonToTarget[i]!;
      const matrix = new THREE.Matrix4();
      matrix.makeRotationFromQuaternion(transform.rotation);
      matrix.setPosition(transform.translation);
      const inverse = new THREE.Matrix4();
      inverse.copy(matrix).invert();
      // Left multiply: result = inverse * result
      const temp = new THREE.Matrix4();
      temp.multiplyMatrices(inverse, resultTransform);
      resultTransform = temp;
    }

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    resultTransform.decompose(position, quaternion, new THREE.Vector3());

    return {
      translation: position,
      rotation: quaternion,
    };
  }

  public clear(): void {
    this.frames.clear();
    this.rootFrame = null;
    this.notifyChange();
  }

  public hasFrame(frameId: string): boolean {
    return this.frames.has(frameId);
  }

  public transformPoint(point: THREE.Vector3, sourceFrame: string, targetFrame: string): THREE.Vector3 | null {
    const transform = this.findTransform(targetFrame, sourceFrame);
    if (!transform) {
      return null;
    }

    const matrix = new THREE.Matrix4();
    matrix.makeRotationFromQuaternion(transform.rotation);
    matrix.setPosition(transform.translation);
    
    return point.clone().applyMatrix4(matrix);
  }

  public transformPoints(points: THREE.Vector3[], sourceFrame: string, targetFrame: string): THREE.Vector3[] | null {
    const transform = this.findTransform(targetFrame, sourceFrame);
    if (!transform) {
      return null;
    }

    const matrix = new THREE.Matrix4();
    matrix.makeRotationFromQuaternion(transform.rotation);
    matrix.setPosition(transform.translation);
    
    return points.map(point => point.clone().applyMatrix4(matrix));
  }

  public getTransformMatrix(sourceFrame: string, targetFrame: string): THREE.Matrix4 | null {
    const transform = this.findTransform(targetFrame, sourceFrame);
    if (!transform) {
      return null;
    }

    const matrix = new THREE.Matrix4();
    matrix.makeRotationFromQuaternion(transform.rotation);
    matrix.setPosition(transform.translation);
    return matrix;
  }
}

