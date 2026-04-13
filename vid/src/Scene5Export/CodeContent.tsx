import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const MONO = '"SF Mono","Fira Code","Cascadia Code",monospace';

// ── Terraform lines (matches Scene 3 architecture + serverless) ──
const CODE_LINES: Array<Array<{ text: string; color: string }>> = [
  // 0  VPC
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_vpc"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"main"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 1
  [{ text: '  cidr_block           = ', color: "#abb2bf" }, { text: '"10.0.0.0/16"', color: "#98c379" }],
  // 2
  [{ text: '  enable_dns_hostnames = ', color: "#abb2bf" }, { text: 'true', color: "#d19a66" }],
  // 3
  [{ text: '}', color: "#abb2bf" }],
  // 4  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 5  Subnet
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_subnet"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"public_a"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 6
  [{ text: '  vpc_id     = ', color: "#abb2bf" }, { text: 'aws_vpc.main.id', color: "#61afef" }],
  // 7
  [{ text: '  cidr_block = ', color: "#abb2bf" }, { text: '"10.0.1.0/24"', color: "#98c379" }],
  // 8
  [{ text: '}', color: "#abb2bf" }],
  // 9  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 10  ALB
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_lb"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"app"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 11
  [{ text: '  name               = ', color: "#abb2bf" }, { text: '"app-alb"', color: "#98c379" }],
  // 12
  [{ text: '  internal           = ', color: "#abb2bf" }, { text: 'false', color: "#d19a66" }],
  // 13
  [{ text: '  load_balancer_type = ', color: "#abb2bf" }, { text: '"application"', color: "#98c379" }],
  // 14
  [{ text: '  subnets            = [', color: "#abb2bf" }, { text: 'aws_subnet.public_a.id', color: "#61afef" }, { text: ']', color: "#abb2bf" }],
  // 15
  [{ text: '}', color: "#abb2bf" }],
  // 16  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 17  Lambda
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_lambda_function"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"user_svc"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 18
  [{ text: '  function_name = ', color: "#abb2bf" }, { text: '"user-service"', color: "#98c379" }],
  // 19
  [{ text: '  runtime       = ', color: "#abb2bf" }, { text: '"nodejs20.x"', color: "#98c379" }],
  // 20
  [{ text: '  handler       = ', color: "#abb2bf" }, { text: '"index.handler"', color: "#98c379" }],
  // 21
  [{ text: '}', color: "#abb2bf" }],
  // 22  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 23  DynamoDB
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_dynamodb_table"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"users"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 24
  [{ text: '  name         = ', color: "#abb2bf" }, { text: '"users"', color: "#98c379" }],
  // 25
  [{ text: '  billing_mode = ', color: "#abb2bf" }, { text: '"PAY_PER_REQUEST"', color: "#98c379" }],
  // 26
  [{ text: '  hash_key     = ', color: "#abb2bf" }, { text: '"userId"', color: "#98c379" }],
  // 27
  [{ text: '}', color: "#abb2bf" }],
  // 28  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 29  S3
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_s3_bucket"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"assets"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 30
  [{ text: '  bucket = ', color: "#abb2bf" }, { text: '"drawtocloud-assets"', color: "#98c379" }],
  // 31
  [{ text: '}', color: "#abb2bf" }],
  // 32  (blank)
  [{ text: '', color: "#abb2bf" }],
  // 33  CloudWatch
  [{ text: 'resource', color: "#c678dd" }, { text: ' ', color: "#abb2bf" }, { text: '"aws_cloudwatch_log_group"', color: "#98c379" }, { text: ' ', color: "#abb2bf" }, { text: '"app"', color: "#98c379" }, { text: ' {', color: "#abb2bf" }],
  // 34
  [{ text: '  name              = ', color: "#abb2bf" }, { text: '"/ecs/app"', color: "#98c379" }],
  // 35
  [{ text: '  retention_in_days = ', color: "#abb2bf" }, { text: '30', color: "#d19a66" }],
  // 36
  [{ text: '}', color: "#abb2bf" }],
];

const STAGGER = 1; // frames per line — snappy generation
const ANIM_DURATION = 5; // frames per line animation — quick entrance

interface Props {
  fadeInFrom: number;
  isVisible: boolean;
}

export const CodeContent: React.FC<Props> = ({ fadeInFrom, isVisible }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [fadeInFrom, fadeInFrom + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Instant hide — no fade-out animation
  if (!isVisible || opacity <= 0) return null;

  return (
    <div
      style={{
        padding: "8px 0",
        opacity,
      }}
    >
      {CODE_LINES.map((segments, i) => {
        const lineStart = fadeInFrom + 8 + i * STAGGER;
        const lineOpacity = interpolate(frame, [lineStart, lineStart + ANIM_DURATION], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const tx = interpolate(frame, [lineStart, lineStart + ANIM_DURATION], [-8, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              fontFamily: MONO,
              fontSize: 13,
              lineHeight: 1.7,
              opacity: lineOpacity,
              transform: `translateX(${tx}px)`,
              whiteSpace: "pre",
              height: segments[0].text === "" ? 6 : undefined,
            }}
          >
            {segments.map((seg, j) => (
              <span key={j} style={{ color: seg.color }}>{seg.text}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
};
