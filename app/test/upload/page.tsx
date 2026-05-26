import { UploadTester } from '@/components/dev/upload-tester';

/**
 * This is a temporary page for running the upload stress test.
 * You can access it at http://localhost:3000/test/upload
 */
export default function UploadTestPage() {
  return (
    <div className="w-full min-h-screen bg-background">
      <UploadTester />
    </div>
  );
}