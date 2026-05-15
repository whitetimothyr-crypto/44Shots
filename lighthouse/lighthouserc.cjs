module.exports = {
  ci: {
    collect: {
      url: [
        'https://44shots.com/',
        'https://44shots.com/?screen=signin'
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --disable-dev-shm-usage'
      }
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.70 }],
        'categories:accessibility': ['error', { minScore: 0.90 }],
        'categories:best-practices': ['warn', { minScore: 0.85 }],
        'categories:seo': ['warn', { minScore: 0.80 }],
        'errors-in-console': 'error',
        'is-on-https': 'error'
      }
    },
    upload: {
      target: 'temporary-public-storage'
    }
  }
};
