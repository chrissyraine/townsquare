import { useEffect, useRef } from 'react';

export default function SparkleTrail() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.color = '#C8A96A'; // Forever Still Gold
        this.life = 1.0; // Opacity
        this.decay = Math.random() * 0.02 + 0.02;
      }
      
      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= this.decay;
        this.size -= 0.05;
      }
      
      draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        
        // Draw a 4-point star/sparkle
        const spikeCount = 4;
        const outerRadius = this.size * 2;
        const innerRadius = this.size;
        let rot = Math.PI / 2 * 3;
        let x = this.x;
        let y = this.y;
        let step = Math.PI / spikeCount;

        ctx.moveTo(this.x, this.y - outerRadius);
        for (let i = 0; i < spikeCount; i++) {
          x = this.x + Math.cos(rot) * outerRadius;
          y = this.y + Math.sin(rot) * outerRadius;
          ctx.lineTo(x, y);
          rot += step;

          x = this.x + Math.cos(rot) * innerRadius;
          y = this.y + Math.sin(rot) * innerRadius;
          ctx.lineTo(x, y);
          rot += step;
        }
        ctx.lineTo(this.x, this.y - outerRadius);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    const handleMouseMove = (e) => {
      // Add a couple of particles on mouse move
      for (let i = 0; i < 2; i++) {
        particles.push(new Particle(e.clientX, e.clientY));
      }
    };

    window.addEventListener('mousemove', handleMouseMove);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
      }
      
      // Remove dead particles
      particles = particles.filter(p => p.life > 0 && p.size > 0);
      
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
