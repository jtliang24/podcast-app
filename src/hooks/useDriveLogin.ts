import { useGoogleLogin } from '@react-oauth/google';
import { AndroidDrive, isAndroid } from '../services/android';

interface DriveLogin {
  onSuccess: (token: string) => void;
  onError: () => void;
}

function useBrowserDriveLogin({ onSuccess, onError }: DriveLogin) {
  return useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    onSuccess: result => onSuccess(result.access_token),
    onError,
  });
}

function useAndroidDriveLogin({ onSuccess, onError }: DriveLogin) {
  return () => {
    void AndroidDrive.authorize({ interactive: true }).then(({ token }) => {
      if (token) onSuccess(token);
    }, onError);
  };
}

export const useDriveLogin = isAndroid ? useAndroidDriveLogin : useBrowserDriveLogin;
