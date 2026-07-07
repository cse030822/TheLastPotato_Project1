// MediaPipe Hands 21개 관절 인덱스와 뼈대 연결 정의.
// 0: 손목(WRIST)
// 1-4: 엄지(THUMB, 4=끝)
// 5-8: 검지(INDEX, 5=뿌리 MCP, 8=끝)
// 9-12: 중지(MIDDLE, 9=뿌리 MCP)
// 13-16: 약지(RING)
// 17-20: 새끼(PINKY)

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

// 뼈대를 그리기 위한 관절 연결쌍
export const HAND_CONNECTIONS: [number, number][] = [
  // 엄지
  [0, 1], [1, 2], [2, 3], [3, 4],
  // 검지
  [0, 5], [5, 6], [6, 7], [7, 8],
  // 중지
  [5, 9], [9, 10], [10, 11], [11, 12],
  // 약지
  [9, 13], [13, 14], [14, 15], [15, 16],
  // 새끼
  [13, 17], [17, 18], [18, 19], [19, 20],
  // 손바닥 아래
  [0, 17],
];

export interface Landmark {
  x: number; // 0~1 (원본 이미지 기준, 거울 아님)
  y: number; // 0~1
  z: number;
}
