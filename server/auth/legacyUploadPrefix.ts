/**
 * 去掉 ClientProfile 之前，上传目录是 shows/user-uploads/{clientProfileId}/。
 * 对象存储和库里的完整 URL 不改。出图 / 全身照校验时，这 3 个老目录仍算对应用户的。
 * 新用户不在表里，只认 user-uploads/{userId}/。
 */
const LEGACY_UPLOAD_PREFIX_BY_USER_ID: Record<string, string> = {
  cmv3mqdxe0001bqs8bc5nsmmx: '5265a6b5-32f4-48ab-8b57-8117616034be',
  cmvkr6c2v0012tus8fphe4jgn: 'cmvkr6buq0011tus8dfpw3jn2',
  cmvuojvcv0007gms8j6f26wqz: 'cmvuojv5x0006gms8qan1gvj4',
};

export function legacyUploadPrefixFor(userId: string): string | null {
  return LEGACY_UPLOAD_PREFIX_BY_USER_ID[userId] ?? null;
}
