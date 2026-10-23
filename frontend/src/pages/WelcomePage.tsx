import { Link } from 'react-router-dom'
import { BackendStatus } from '../components/BackendStatus'

export function WelcomePage() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="HealthCareAssist AI home">
          <span className="brand-mark" aria-hidden="true">✚</span>
          <span>HealthCareAssist <span className="brand-ai">AI</span></span>
        </a>
        <Link className="text-link" to="/dashboard">Open dashboard <span aria-hidden="true">↗</span></Link>
      </header>
      <main>
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-copy">
            <p className="eyebrow">A thoughtful start to better support</p>
            <h1 id="welcome-title">Welcome to <br /><span>HealthCareAssist AI</span></h1>
            <p className="intro">A foundation for simpler, more connected healthcare support.</p>
            <p className="welcome-detail">Your workspace starts here. Check the application connection below as we build the next chapter of healthcare assistance.</p>
            <a className="text-link" href="#connection-title">View connection status <span aria-hidden="true">↓</span></a>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
            <div className="art-cross">✚</div>
            <svg className="pulse" viewBox="0 0 360 100" fill="none">
              <path d="M0 50H105L125 30L150 75L183 10L210 90L235 50H360" />
            </svg>
            <span className="art-caption">Connected care begins here</span>
          </div>
        </section>
        <BackendStatus />
      </main>
      <footer>HealthCareAssist AI <span>Built with care. Beginning with connection.</span></footer>
    </div>
  )
}
