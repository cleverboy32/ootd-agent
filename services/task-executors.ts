import { uploadFileToGCS, getClientId } from '@/lib/utils';

// Helper function for simulated delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const FAKE_GCS_URL_PREFIX = 'https://fake-storage.googleapis.com/test-images/';

/**
 * Executes the file upload process.
 * If the file is a test file (name starts with 'test_image_'), it simulates the upload.
 * Otherwise, it performs a real upload.
 */
export async function executeUpload(file: File): Promise<string> {
  // Check if it's a test file
  if (file.name.startsWith('test_image_')) {
    console.log(`[DRY RUN] Simulating upload for: ${file.name}`);
    await sleep(1000 + Math.random() * 1000); // Simulate 1-2 second upload
    return `${FAKE_GCS_URL_PREFIX}${file.name}`;
  }

  const publicUrl = await uploadFileToGCS(file);
  return publicUrl;
}

/**
 * Executes the AI analysis process.
 * If the imageUrl is a simulated test URL, it simulates the analysis.
 * Otherwise, it performs a real analysis.
 */
export async function executeAnalysis(imageUrl: string): Promise<{ status: string; message: string; }> {
  // Check if it's a test URL
  if (imageUrl.startsWith(FAKE_GCS_URL_PREFIX)) {
    console.log(`[DRY RUN] Simulating AI analysis for: ${imageUrl}`);
    await sleep(2000 + Math.random() * 2000); // Simulate 2-4 second analysis

    // Simulate random success or failure for testing purposes
    const isSuccess = Math.random() > 0.15; // 85% success rate

    if (isSuccess) {
      console.log(`[DRY RUN] Simulated analysis SUCCESS for: ${imageUrl}`);
      // Return a mock success response, mirroring what the real API would do.
      return { status: 'success', message: 'Simulated analysis complete.' };
    } else {
      console.warn(`[DRY RUN] Simulated analysis FAILURE for: ${imageUrl}`);
      // Throw an error to mimic a real API failure.
      throw new Error('Simulated AI analysis failed.');
    }
  }

  // Real analysis for non-test URLs
  const clientId = getClientId();
  const analyzeResponse = await fetch('/api/wardrobe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-ID': clientId },
    body: JSON.stringify({ imageUrl }),
  });

  if (!analyzeResponse.ok) {
    const errorData = await analyzeResponse.json();
    throw new Error(errorData.error || 'AI 分析失败');
  }

  return analyzeResponse.json();
}

