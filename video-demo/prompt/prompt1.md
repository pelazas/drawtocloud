I want to build a 20-second (600 frames at 30fps) promotional video for my web application "DrawToCloud" using Remotion. 
Please act as an expert Remotion developer. I have installed the 'remotion-best-practices' skills in this workspace, so please reference those rules, especially for animations, sequencing, and spring dynamics.
Please create a root Composition called `DrawToCloudPromo` and break the video down into the following 5 sequenced scenes:
1. **Intro (Frames 0-60):** 
   A clean title screen with the text matching our brand typography: "Introducing DrawToCloud, generate AWS infrastructure with AI". Use a smooth fade-in and a slight scale-up animation.
2. **The Workflow (Frames 60-240):**
   Show a sequence using the images in the `public` folder:
   - Copy prompt in `copy-prompt.png`, use effect to click on the copy button
   - Paste prompt to an AI with project context: `paste-prompt1.png` and `paste-prompt2.png`
   - Copy the response from the AI, use effect to select the text: `copy-response1.png`, `copy-response2.png`
   - Paste the response in drawtocloud `paste-response.png` and use a simulated to paste the response into the description form.
   - Animate a mouse cursor clicking the "Generate" button. `paste-response.png`
3. **Live Canvas Building (Frames 240-420):**
    Use as context the /Users/pelazas/Desktop/drawtocloud/frontend/components/Canvas.tsx
   - Zoom into a canvas area (matching the React Flow style).
   - Animate architecture nodes popping into existence one by one using a staggered `spring()` animation.
   - The final diagram should look something like `generated-architecture.png`
   - Draw dynamic SVG edge lines between them after they appear.
   - Please read `../documents/styleguide.md` to get the exact hex colors for these specific node types (e.g., Network is blue, Compute is orange, Database is green).
4. **Outputs (Frames 420-540):**
   - Slide a side-panel into view from the right side of the screen. Inside the panel, display terraform code such as `generated-code.png` (the generated Terraform code).
   - Scroll up a bottom panel component showing `generated-cost.png` highlighting the price
5. **Outro (Frames 540-600):**
   - Fade everything out.
   - Fade in with drawtocloud in the center, with the 'to' from drawtocloud being in bold in the center of the screen with the tagline "Figma for cloud infra" underneath it.

Please write the complete React components for these scenes. Use standard inline styles or Tailwind (if configured) so it looks extremely polished, modern, and matches a high-end SaaS product launch video.