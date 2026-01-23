import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ============================================
// Sound Manager (Ambient Piano)
// ============================================

class SoundManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.reverbNode = null;
        this.isInitialized = false;

        // Scales
        // Default: Pentatonic / Lydian feel (Bright/Dreamy)
        this.scaleDefault = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

        // Inverted: Phrygian / Minor (Dark/Eerie) - Lower octave
        this.scaleInverted = [48, 49, 52, 53, 55, 57, 58, 60, 64, 65];
        // C3, Db3, E3, F3, G3, A3, Bb3, C4...

        this.currentScale = this.scaleDefault;
        this.isInverted = false;

        this.lastNoteTime = 0;
        this.noteDensity = 0.15; // Min time between notes

        // Performance limits
        this.maxVoices = 8;
        this.activeVoices = 0;

        this.isMuted = false;
    }

    setInverted(isInverted) {
        this.isInverted = isInverted;
        this.currentScale = isInverted ? this.scaleInverted : this.scaleDefault;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            // Smooth fade to avoid clicking
            const t = this.ctx.currentTime;
            this.masterGain.gain.cancelScheduledValues(t);
            this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.4, t, 0.1);
        }
        console.log(this.isMuted ? 'Audio Muted' : 'Audio Unmuted');
        return this.isMuted;
    }

    init() {
        if (this.isInitialized) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;
        this.masterGain.connect(this.ctx.destination);

        // Reverb Convolver
        this.reverbNode = this.ctx.createConvolver();
        // Reduced duration from 3.0 to 2.0 for performance
        this.reverbNode.buffer = this.createImpulseResponse(2.0, 2.0);
        this.reverbNode.connect(this.masterGain);

        this.isInitialized = true;
        console.log('Audio Context Initialized');
    }

    createImpulseResponse(duration, decay) {
        const rate = this.ctx.sampleRate;
        const length = rate * duration;
        const impulse = this.ctx.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const n = i / length;
            // Exponential fade
            const env = Math.pow(1 - n, decay);
            // Randomized noise
            left[i] = (Math.random() * 2 - 1) * env;
            right[i] = (Math.random() * 2 - 1) * env;
        }

        return impulse;
    }

    triggerInteractionSound(intensity) {
        if (!this.isInitialized || this.isMuted) return;

        // Ensure context is running (sometimes it suspends on load)
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        if (this.activeVoices >= this.maxVoices) return;

        const now = this.ctx.currentTime;

        // Rate limiting based on previous note
        if (now - this.lastNoteTime < this.noteDensity) return;

        this.playNote();
        this.lastNoteTime = now;
    }

    playNote() {
        if (!this.ctx) return;

        // Debug log
        console.log(`Playing note: CTX State: ${this.ctx.state}, MasterGain: ${this.masterGain.gain.value}`);

        this.activeVoices++;

        // Pick a random note from current scale
        const midiNote = this.currentScale[Math.floor(Math.random() * this.currentScale.length)];
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // Create Oscillator (Keys)
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator(); // Detuned slightly for richness

        osc.type = this.isInverted ? 'sawtooth' : 'sine'; // Sawtooth for harsher/darker sound when inverted
        osc2.type = 'triangle';

        osc.frequency.value = freq;
        osc2.frequency.value = freq;
        osc2.detune.value = this.isInverted ? -10 : 4; // More detuning for weirdness when inverted

        // Envelope
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;

        // Attack
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.05); // Louder attack
        // Decay/Release
        const releaseTime = this.isInverted ? 4.0 : 2.5;
        gain.gain.exponentialRampToValueAtTime(0.001, t + releaseTime);

        // Connect graph
        osc.connect(gain);
        osc2.connect(gain);

        // Split output: Dry (direct) + Wet (Reverb)
        gain.connect(this.masterGain); // Direct
        gain.connect(this.reverbNode); // To Reverb

        osc.start(t);
        osc2.start(t);

        osc.stop(t + releaseTime + 0.5);
        osc2.stop(t + releaseTime + 0.5);

        // Garbage collection helpers
        setTimeout(() => {
            gain.disconnect();
            this.activeVoices--;
        }, (releaseTime + 0.5) * 1000);
    }
}

// ============================================
// Particle Simulation Class
// ============================================

class ParticleSimulation {
    constructor() {
        // Configuration
        this.config = {
            particleCount: 90000,
            particleSize: 2.5,
            mouseRadius: 150,
            mouseForce: 1.0,
            returnSpeed: 0.0009,
            rotationSpeed: 0.003,
            noiseAmount: 0.1,
            shape: 'sphere',
            bloomStrength: 1.5,
            bloomRadius: 0.8,
            bloomThreshold: 0.1,
            windStrength: 0.09,
            windTurbulence: 0.2,
            damping: 0.96,
        };

        // State
        this.mouse = new THREE.Vector2(9999, 9999);
        this.mouseWorld = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.clock = new THREE.Clock();
        this.isMouseDown = false;

        // Audio
        this.soundManager = new SoundManager();
        this.hasInteracted = false;

        // Shape transformation state
        this.currentShape = 'sphere';
        this.shapeOrder = ['sphere', 'cube', 'pyramid'];
        this.chaosLevel = 0;
        this.transformThreshold = 5000;
        this.isTransforming = false;
        this.cooldown = 0;
        this.shapes = {
            sphere: null,
            cube: null,
            pyramid: null
        };

        // Freeze time state
        this.isFrozen = false;

        // Color inversion state
        this.isInverted = false;

        // Custom cursor
        this.customCursor = document.getElementById('custom-cursor');

        // Initialize
        this.init();
        this.createParticles();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.animate();
    }

    // ============================================
    // Initialization
    // ============================================

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.z = 400;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;

        const container = document.getElementById('canvas-container');
        container.appendChild(this.renderer.domElement);

        // Invisible plane for mouse interaction
        this.interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }

    // ============================================
    // Wireframe Room (for depth perception)
    // ============================================



    // ============================================
    // Post Processing
    // ============================================

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Film Grain Shader
        const FilmGrainShader = {
            uniforms: {
                'tDiffuse': { value: null },
                'time': { value: 0 },
                'noiseIntensity': { value: 0.03 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float time;
                uniform float noiseIntensity;
                varying vec2 vUv;
                
                float random(vec2 co) {
                    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
                }
                
                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);
                    float noise = random(vUv + time) * 2.0 - 1.0;
                    color.rgb += noise * noiseIntensity;
                    gl_FragColor = color;
                }
            `
        };

        this.grainPass = new ShaderPass(FilmGrainShader);
        this.composer.addPass(this.grainPass);
    }

    // ============================================
    // Particle Creation
    // ============================================

    createParticles() {
        if (this.particles) {
            this.scene.remove(this.particles);
            this.geometry.dispose();
            this.material.dispose();
        }

        this.geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.config.particleCount * 3);
        const originalPositions = new Float32Array(this.config.particleCount * 3);
        const velocities = new Float32Array(this.config.particleCount * 3);
        const colors = new Float32Array(this.config.particleCount * 3);
        const sizes = new Float32Array(this.config.particleCount);

        // Generate positions for all shapes
        this.shapes.sphere = new Float32Array(this.config.particleCount * 3);
        this.shapes.cube = new Float32Array(this.config.particleCount * 3);
        this.shapes.pyramid = new Float32Array(this.config.particleCount * 3);

        this.generateShapePositions(this.shapes.sphere, 'sphere');
        this.generateShapePositions(this.shapes.cube, 'cube');
        this.generateShapePositions(this.shapes.pyramid, 'pyramid');

        // Initial positions (start as sphere)
        for (let i = 0; i < this.config.particleCount * 3; i++) {
            positions[i] = this.shapes.sphere[i];
            originalPositions[i] = this.shapes.sphere[i];
        }

        // Initialize velocities to zero
        for (let i = 0; i < this.config.particleCount * 3; i++) {
            velocities[i] = 0;
        }

        // Set colors (very dark grey/white gradient)
        for (let i = 0; i < this.config.particleCount; i++) {
            const brightness = 0.7 + Math.random() * 0.3;
            colors[i * 3] = brightness;
            colors[i * 3 + 1] = brightness;
            colors[i * 3 + 2] = brightness;
            sizes[i] = 0.5 + Math.random() * 0.5;
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('originalPosition', new THREE.BufferAttribute(originalPositions, 3));
        this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Shader Material
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: this.config.particleSize },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
                uFocalDistance: { value: 400.0 },
                uDepthFade: { value: 200.0 },
            },
            vertexShader: `
                attribute vec3 originalPosition;
                attribute vec3 velocity;
                attribute float size;
                
                uniform float uTime;
                uniform float uSize;
                uniform float uPixelRatio;
                uniform float uFocalDistance;
                uniform float uDepthFade;
                
                varying vec3 vColor;
                varying float vAlpha;
                varying float vDepthBlur;
                
                void main() {
                    vColor = color;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float distanceFromCamera = -mvPosition.z;
                    float depthFade = 1.0 - smoothstep(uFocalDistance - uDepthFade, uFocalDistance + uDepthFade, distanceFromCamera);
                    
                    float displacement = length(position - originalPosition);
                    float displacementAlpha = 1.0 - smoothstep(0.0, 100.0, displacement) * 0.3;
                    
                    vAlpha = depthFade * displacementAlpha;
                    
                    float distanceFromFocus = abs(distanceFromCamera - uFocalDistance);
                    vDepthBlur = smoothstep(0.0, 150.0, distanceFromFocus);
                    
                    float depthSizeFactor = 1.0 - vDepthBlur * 0.5;
                    float breathe = 1.0 + sin(uTime * 1.5) * 0.03;
                    
                    gl_PointSize = size * uSize * uPixelRatio * (300.0 / -mvPosition.z) * depthSizeFactor * breathe;
                    gl_PointSize = max(gl_PointSize, 0.5);
                    
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying float vDepthBlur;
                
                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float dist = length(center);
                    
                    float blurAmount = 0.5 + vDepthBlur * 0.3;
                    float alpha = 1.0 - smoothstep(0.0, blurAmount, dist);
                    alpha *= vAlpha;
                    
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            vertexColors: true,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        this.particles = new THREE.Points(this.geometry, this.material);
        this.scene.add(this.particles);
    }

    // ============================================
    // Shape Generation
    // ============================================

    generateShapePositions(targetArray, shapeType) {
        const radius = 150;

        for (let i = 0; i < this.config.particleCount; i++) {
            let x, y, z;

            switch (shapeType) {
                case 'sphere':
                    const phi = Math.acos(2 * Math.random() - 1);
                    const theta = Math.random() * Math.PI * 2;
                    const r = radius * Math.cbrt(Math.random());
                    x = r * Math.sin(phi) * Math.cos(theta);
                    y = r * Math.sin(phi) * Math.sin(theta);
                    z = r * Math.cos(phi);
                    break;

                case 'cube':
                    x = (Math.random() - 0.5) * radius * 1.5;
                    y = (Math.random() - 0.5) * radius * 1.5;
                    z = (Math.random() - 0.5) * radius * 1.5;
                    break;

                case 'pyramid':
                    const height = 180;
                    const baseWidth = 180;

                    // More uniform distribution - linear height sampling
                    const hRand = Math.random();
                    const uPyramid = hRand; // Linear distribution for more uniform feel

                    y = (0.5 - uPyramid) * height; // Tip at top, base at bottom

                    const scale = uPyramid; // Scale increases toward base

                    x = (Math.random() - 0.5) * baseWidth * scale;
                    z = (Math.random() - 0.5) * baseWidth * scale;
                    break;

                default:
                    x = y = z = 0;
            }

            targetArray[i * 3] = x;
            targetArray[i * 3 + 1] = y;
            targetArray[i * 3 + 2] = z;
        }
    }

    // ============================================
    // UI Setup
    // ============================================







    // ============================================
    // Event Listeners
    // ============================================

    setupEventListeners() {
        // Mouse move
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

            // Update custom cursor position
            if (this.customCursor) {
                this.customCursor.style.left = e.clientX + 'px';
                this.customCursor.style.top = e.clientY + 'px';
            }

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersectPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.interactionPlane, intersectPoint);
            this.mouseWorld.copy(intersectPoint);
        });

        // Mouse down/up - Click to change shape
        window.addEventListener('mousedown', () => {
            if (!this.hasInteracted) {
                this.soundManager.init();
                this.hasInteracted = true;
            }

            this.isMouseDown = true;
            if (this.customCursor) this.customCursor.classList.add('active');
            this.toggleShape();
        });
        window.addEventListener('mouseup', () => {
            this.isMouseDown = false;
            if (this.customCursor) this.customCursor.classList.remove('active');
        });

        // Touch support
        window.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersectPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.interactionPlane, intersectPoint);
            this.mouseWorld.copy(intersectPoint);
        }, { passive: false });

        window.addEventListener('touchstart', (e) => {
            this.isMouseDown = true;
            const touch = e.touches[0];
            this.mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        });

        window.addEventListener('touchend', () => this.isMouseDown = false);

        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.toggleShape();
            }
            if (e.code === 'KeyF') {
                e.preventDefault();
                this.isFrozen = !this.isFrozen;
                console.log(this.isFrozen ? 'Time frozen' : 'Time unfrozen');
            }
            if (e.code === 'KeyI') {
                e.preventDefault();
                this.toggleInvert();
            }
            if (e.code === 'KeyM') {
                e.preventDefault();
                if (this.soundManager) {
                    this.soundManager.toggleMute();
                }
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    resetParticles() {
        const positions = this.geometry.attributes.position.array;
        const originalPositions = this.geometry.attributes.originalPosition.array;
        const velocities = this.geometry.attributes.velocity.array;

        for (let i = 0; i < this.config.particleCount * 3; i++) {
            positions[i] = originalPositions[i];
            velocities[i] = 0;
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.velocity.needsUpdate = true;
    }

    // ============================================
    // Simplex Noise
    // ============================================

    noise3D(x, y, z) {
        const dot = x * 12.9898 + y * 78.233 + z * 37.719;
        return Math.sin(dot) * 43758.5453 % 1;
    }

    // ============================================
    // Animation Loop
    // ============================================

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();

        // Update uniforms
        this.material.uniforms.uTime.value = time;



        // Always rotate particles (even when frozen) - reverse direction when inverted
        const spinDirection = this.isInverted ? -1 : 1;
        this.particles.rotation.y += this.config.rotationSpeed * spinDirection;

        // Only update particle physics if not frozen
        if (!this.isFrozen) {
            this.updateParticles(time);
        }

        // Render with post-processing
        this.composer.render();
    }

    updateParticles(time) {
        const positions = this.geometry.attributes.position.array;
        const originalPositions = this.geometry.attributes.originalPosition.array;
        const velocities = this.geometry.attributes.velocity.array;

        const mouseRadius = this.config.mouseRadius;
        const mouseForce = this.config.mouseForce * (this.isMouseDown ? 2.5 : 1);
        const returnSpeed = this.config.returnSpeed;
        const noiseAmount = this.config.noiseAmount;
        const windStrength = this.config.windStrength;
        const windTurbulence = this.config.windTurbulence;
        const damping = this.config.damping;

        const windAngle = time * 0.1;
        const windX = Math.cos(windAngle) * windStrength;
        const windY = Math.sin(windAngle * 0.7) * windStrength * 0.5;
        const windZ = Math.sin(windAngle * 0.5) * windStrength * 0.3;

        if (this.cooldown > 0) this.cooldown--;

        const mousePos = this.mouseWorld.clone();
        mousePos.applyMatrix4(this.particles.matrixWorld.clone().invert());

        // Performance: Accumulate interaction energy instead of checking audio per particle
        let totalInteractionForce = 0;

        for (let i = 0; i < this.config.particleCount; i++) {
            const i3 = i * 3;

            const x = positions[i3];
            const y = positions[i3 + 1];
            const z = positions[i3 + 2];

            const ox = originalPositions[i3];
            const oy = originalPositions[i3 + 1];
            const oz = originalPositions[i3 + 2];

            const dispX = x - ox;
            const dispY = y - oy;
            const dispZ = z - oz;
            const displacement = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);

            const dx = x - mousePos.x;
            const dy = y - mousePos.y;
            const dz = z - mousePos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < mouseRadius && dist > 0) {
                const force = (1 - dist / mouseRadius) * (1 - dist / mouseRadius) * mouseForce;
                const tangentX = -dy * 0.3;
                const tangentY = dx * 0.3;

                velocities[i3] += (dx / dist) * force + tangentX * force * 0.2;
                velocities[i3 + 1] += (dy / dist) * force + tangentY * force * 0.2;
                velocities[i3 + 2] += (dz / dist) * force;

                // Accumulate energy for audio
                if (force > 0.1) {
                    totalInteractionForce += force;
                }
            }

            const windInfluence = Math.min(displacement / 50, 1) * 0.5;

            const turbX = this.noise3D(x * 0.01 + time * 0.2, y * 0.01, z * 0.01);
            const turbY = this.noise3D(x * 0.01, y * 0.01 + time * 0.2, z * 0.01);
            const turbZ = this.noise3D(x * 0.01, y * 0.01, z * 0.01 + time * 0.2);

            velocities[i3] += (windX + turbX * windTurbulence) * windInfluence * 0.05;
            velocities[i3 + 1] += (windY + turbY * windTurbulence) * windInfluence * 0.05;
            velocities[i3 + 2] += (windZ + turbZ * windTurbulence) * windInfluence * 0.05;

            if (displacement > 0.1) {
                const pullStrength = returnSpeed * (1 + displacement * 0.01);
                velocities[i3] += (ox - x) * pullStrength;
                velocities[i3 + 1] += (oy - y) * pullStrength;
                velocities[i3 + 2] += (oz - z) * pullStrength;
            }

            if (noiseAmount > 0) {
                const noiseScale = 0.01;
                const noiseTime = time * 0.2;
                velocities[i3] += this.noise3D(x * noiseScale + noiseTime, y * noiseScale, z * noiseScale) * noiseAmount * 0.01;
                velocities[i3 + 1] += this.noise3D(x * noiseScale, y * noiseScale + noiseTime, z * noiseScale) * noiseAmount * 0.01;
                velocities[i3 + 2] += this.noise3D(x * noiseScale, y * noiseScale, z * noiseScale + noiseTime) * noiseAmount * 0.01;
            }

            positions[i3] += velocities[i3];
            positions[i3 + 1] += velocities[i3 + 1];
            positions[i3 + 2] += velocities[i3 + 2];

            velocities[i3] *= damping;
            velocities[i3 + 1] *= damping;
            velocities[i3 + 2] *= damping;
        }

        // Trigger audio once per frame based on total energy
        if (totalInteractionForce > 5.0) { // Threshold for "meaningful" interaction
            // Normalize probability: more force = higher chance, but capped
            // This is drastically cheaper than Math.random() * 90000 times
            if (Math.random() < Math.min(totalInteractionForce * 0.005, 0.5)) {
                this.soundManager.triggerInteractionSound(totalInteractionForce);
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.velocity.needsUpdate = true;

        if (this.isTransforming) {
            this.geometry.attributes.originalPosition.needsUpdate = true;
            this.isTransforming = false;
        }
    }

    toggleShape() {
        const currentIndex = this.shapeOrder.indexOf(this.currentShape);
        const nextIndex = (currentIndex + 1) % this.shapeOrder.length;
        this.currentShape = this.shapeOrder[nextIndex];

        const newTarget = this.shapes[this.currentShape];
        const originalPositions = this.geometry.attributes.originalPosition.array;

        for (let i = 0; i < this.config.particleCount * 3; i++) {
            originalPositions[i] = newTarget[i];
        }

        this.isTransforming = true;
        console.log(`Transformed to ${this.currentShape}`);
    }

    toggleInvert() {
        this.isInverted = !this.isInverted;

        if (this.isInverted) {
            // Invert: white background, black particles
            this.scene.background = new THREE.Color(0xffffff);
            const colors = this.geometry.attributes.color.array;
            for (let i = 0; i < this.config.particleCount; i++) {
                colors[i * 3] = 0.1 + Math.random() * 0.2;
                colors[i * 3 + 1] = 0.1 + Math.random() * 0.2;
                colors[i * 3 + 2] = 0.1 + Math.random() * 0.2;
            }
            this.geometry.attributes.color.needsUpdate = true;
            document.body.classList.add('inverted');
        } else {
            // Normal: dark background, white particles
            this.scene.background = new THREE.Color(0x0a0a0a);
            const colors = this.geometry.attributes.color.array;
            for (let i = 0; i < this.config.particleCount; i++) {
                const brightness = 0.7 + Math.random() * 0.3;
                colors[i * 3] = brightness;
                colors[i * 3 + 1] = brightness;
                colors[i * 3 + 2] = brightness;
            }
            this.geometry.attributes.color.needsUpdate = true;
            document.body.classList.remove('inverted');
        }

        // Update Sound Manager
        if (this.soundManager) {
            this.soundManager.setInverted(this.isInverted);
        }

        console.log(this.isInverted ? 'Colors inverted' : 'Colors normal');
    }
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    new ParticleSimulation();
});
