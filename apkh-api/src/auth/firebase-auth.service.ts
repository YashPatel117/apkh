import { Injectable, UnauthorizedException } from '@nestjs/common';
import { App, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { requireEnv } from 'src/common/constant/env';

/**
 * Verifies Google sign-ins made through Firebase Authentication. Checking an
 * ID token needs only the project ID (Google's public certificates do the
 * rest), so no service-account key is involved.
 */
@Injectable()
export class FirebaseAuthService {
  private app?: App;

  private getApp(): App {
    if (!this.app) {
      this.app =
        getApps()[0] ??
        initializeApp({ projectId: requireEnv('FIREBASE_PROJECT_ID') });
    }
    return this.app;
  }

  async verifyGoogleToken(
    idToken: string,
  ): Promise<{ email: string; name: string }> {
    let decoded: Awaited<
      ReturnType<ReturnType<typeof getAuth>['verifyIdToken']>
    >;
    // Outside the try: a missing FIREBASE_PROJECT_ID is a server error, not a failed sign-in
    const auth = getAuth(this.getApp());
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException(
        'Google sign-in failed. Please try again.',
      );
    }

    if (decoded.firebase.sign_in_provider !== 'google.com') {
      throw new UnauthorizedException('Only Google sign-in is supported.');
    }
    if (!decoded.email || !decoded.email_verified) {
      throw new UnauthorizedException(
        'Your Google account has no verified email.',
      );
    }

    const name = typeof decoded.name === 'string' && decoded.name.trim();
    return {
      email: decoded.email.toLowerCase(),
      name: name || decoded.email.split('@')[0],
    };
  }
}
