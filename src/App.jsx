import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Matrix4, Quaternion, Vector3 } from "three";
import { Canvas, useThree } from "@react-three/fiber";
import Webcam from "react-webcam";
import { Controller as ImageTargetController } from "mind-ar/dist/mindar-image.prod";
import { atom, useAtomValue, useSetAtom } from "jotai";
import './App.css'

const ARContext = createContext();
const anchorsAtom = atom({});
const invisibleMatrix = new Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1);

const AR = memo(function AR({
  children,
  imageTargets,
  filterMinCF = null,
  filterBeta = null,
  warmupTolerance = null,
  missTolerance = null,
  maxTrack,
  webcam,
  container,
}) {

  const {camera} = useThree();
  const [ready, setReady] = useState(false);
  const setAnchors = useSetAtom(anchorsAtom);

  const arContext = useMemo(() => {
    const controller = new ImageTargetController({
      inputWidth: webcam.current.video.videoWidth,
      inputHeight: webcam.current.video.videoHeight,
      filterMinCF,
      filterBeta,
      warmupTolerance,
      missTolerance,
      maxTrack,
    });
    return {controller};
  }, [filterMinCF, filterBeta, warmupTolerance, missTolerance, maxTrack, webcam.current.video.videoWidth, webcam.current.video.videoHeight]);

  const resize = useCallback(() => {
    const { controller } = arContext;

    let vw, vh; // display css width, height
    const videoRatio = webcam.current.video.videoWidth / webcam.current.video.videoHeight;
    const containerRatio = container.current.clientWidth / container.current.clientHeight;
    if(videoRatio > containerRatio) {
        vh = container.current.clientHeight;
        vw = vh * videoRatio;
    } else {
        vw = container.current.clientWidth;
        vh = vw / videoRatio;
    }
    const proj = controller.getProjectionMatrix();

    // TODO: move this logic to controller
    // Handle when phone is rotated, video width and height are swapped
    const inputRatio = controller.inputWidth / controller.inputHeight;
    let inputAdjust;
    if(inputRatio > containerRatio) {
        inputAdjust = webcam.current.video.width / controller.inputWidth;
    } else {
        inputAdjust = webcam.current.video.height / controller.inputHeight;
    }
    let videoDisplayHeight;
    let videoDisplayWidth;
    if(inputRatio > containerRatio) {
        videoDisplayHeight = container.current.clientHeight;
        videoDisplayHeight *= inputAdjust;
    } else {
        videoDisplayWidth = container.current.clientWidth;
        videoDisplayHeight = videoDisplayWidth / controller.inputWidth * controller.inputHeight;
        videoDisplayHeight *= inputAdjust;
    }
    let fovAdjust = container.current.clientHeight / videoDisplayHeight;

    // const fov = 2 * Math.atan(1 / proj[5] / vh * container.clientHeight) * 180 / Math.PI; // vertical fov
    const fov = 2 * Math.atan(1 / proj[5] * fovAdjust) * 180 / Math.PI; // vertical fov
    const near = proj[14] / (proj[10] - 1.0);
    const far = proj[14] / (proj[10] + 1.0);
    const ratio = proj[5] / proj[0]; // (r-1) / (t -b)

    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.aspect = container.current.clientWidth / container.current.clientHeight;
    camera.updateProjectionMatrix();

    webcam.current.video.style.top = (-(vh - container.current.clientHeight) / 2) + "px";
    webcam.current.video.style.left = (-(vw - container.current.clientWidth) / 2) + "px";
    webcam.current.video.style.width = vw + "px";
    webcam.current.video.style.height = vh + "px";
  }, [arContext, camera])

  const onUmount = useCallback(() => {
    window.removeEventListener("resize", resize);
  }, [resize]);

  const startAR = useCallback(async () => {
    console.log('👾 Start AR');

    const { controller } = arContext;

    controller.onUpdate = (data) => {
      if(data.type === 'updateMatrix') {
        const {targetIndex, worldMatrix} = data;

        setAnchors((anchors) => ({
            ...anchors, [targetIndex]: worldMatrix !== null ?
            new Matrix4().fromArray([...worldMatrix]).multiply(postMatrixs[targetIndex]).toArray() :
            invisibleMatrix.toArray()
        }));
      }
    }

    resize();

    const { dimensions: imageTargetDimensions } = await controller.addImageTargets(imageTargets);

    let postMatrixs = [];
    for(let i = 0; i < imageTargetDimensions.length; i++) {
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      const [markerWidth, markerHeight] = imageTargetDimensions[i];
      position.x = markerWidth / 2;
      position.y = markerWidth / 2 + (markerHeight - markerWidth) / 2;
      scale.x = markerWidth;
      scale.y = markerWidth;
      scale.z = markerWidth;
      const postMatrix = new Matrix4();
      postMatrix.compose(position, quaternion, scale);
      postMatrixs.push(postMatrix);
    }

    await controller.dummyRun(webcam.current.video);
    controller.processVideo(webcam.current.video);
  }, [arContext, imageTargets, resize]);

  const stopTracking = useCallback(() => {
    const {controller} = arContext;
    controller.stopProcessVideo();
  }, [arContext]);


  useEffect(() => {
    const loadedMetadataHandler = () => {
      console.log('📹 Ready');
      webcam.current.video.setAttribute('width', webcam.current.video.videoWidth);
      webcam.current.video.setAttribute('height', webcam.current.video.videoHeight);
      const { controller } = arContext;
      controller.inputWidth = webcam.current.video.videoWidth;
      controller.inputHeight = webcam.current.video.videoHeight;
      setReady(true);
    };

    const resizeHandler = () => {
      console.log('📐 Resize')
      resize();
    };

    webcam.current.video.addEventListener('loadedmetadata', loadedMetadataHandler);
    window.addEventListener("resize", resizeHandler);

    return () => {
      webcam.current.video.removeEventListener('loadedmetadata', loadedMetadataHandler);
      window.removeEventListener("resize", resizeHandler);
      stopTracking();
    };
  }, [startAR]);


  useEffect(() => {
    if(ready) {
      startAR();
    }
  }, [ready, startAR])

  const value = useMemo(() => ({ controller: arContext.controller }), [arContext])

  return <ARContext.Provider value={value}>{children}</ARContext.Provider>
});

const useAR = () => {
  const arValue = useContext(ARContext)
  return useMemo(() => ({ ...arValue }), [arValue])
}

function ARAnchor({
  children,
  target = 0,
}) {
  const { controller } = useAR();
  const ref = useRef();
  const anchor = useAtomValue(anchorsAtom)

  useEffect(() => {
    if(ref.current){
      if(controller.inputWidth === 0) {
        return;
      }
      if(anchor[target]) { // L#159
        //if (ref.current.visible !== true && onAnchorFound) onAnchorFound();
          ref.current.visible = true;
          ref.current.matrix = new Matrix4().fromArray(anchor[target]);
      } else {
          //if (ref.current.visible !== false && onAnchorLost) onAnchorLost();
          ref.current.visible = false;
      }
      //console.log(anchor);
    }

  },[controller, anchor, target])

  return (
    <group ref={ref} visible={false} matrixAutoUpdate={false}>
      {children}
    </group>
  )

}


function ARCanvas({
  children,
  arEnabled = true,
  imageTargets,
  container,
}) {
  const webcam = useRef();
  return(
    <>
      <Canvas>
        <AR imageTargets={imageTargets} webcam={webcam} container={container}>
          {children}
        </AR>
      </Canvas>
      <Webcam
        ref={webcam}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: -2,
        }}
      />
    </>
  )
}

function Plane() {
  return(
    <mesh>
        <planeGeometry args={[1,0.55]} />
        <meshBasicMaterial transparent color={0x0000ff} opacity={0.5}/>
    </mesh>
  )
}

function Box() {
  return(
    <mesh position={[5,0,0]} rotation={[0,0.5,0]}>
      <boxGeometry args={[1,1,1]} />
      <meshNormalMaterial />
    </mesh>
  )
}

function App() {
  const container = useRef();
  return(
    <div id="canvas-container" ref={container}>
      <ARCanvas
        container={container}
        imageTargets="https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/image-tracking/assets/card-example/card.mind"
      >
        <ARAnchor>
          <Plane />
        </ARAnchor>
        <Box />
      </ARCanvas>
    </div>
  )
}

export default App;