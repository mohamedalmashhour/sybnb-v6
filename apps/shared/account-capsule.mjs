// Presentation-only account capsule. Real sessions and role assignment belong to the server.
export function renderAccountCapsule({ container, role, language, action }) {
  const t = (fr, en) => language === 'fr' ? fr : en;
  const admin = role === 'admin';
  const driver = role === 'driver';
  const title = admin ? t('Administration', 'Admin') : driver ? t('Chauffeur', 'Driver') : t('Compte', 'Account');
  container.innerHTML = `<section aria-label="${title}"><h3>${title}</h3>
    <div class="tabs" role="group" aria-label="${t('Accès au compte', 'Account access')}">
      <button type="button" id="signInTab">${t('Se connecter', 'Sign in')}</button>
      <button type="button" id="createTab">${t('Créer un compte', 'Create account')}</button>
    </div><div class="form">
    <label>${t('Nom fictif', 'Sample name')}<input readonly value="Demo ${role}"></label>
    <label>${t('Adresse fictive — non modifiable', 'Sample email — not editable')}<input readonly type="email" value="${role}@example.invalid"></label>
    <label>${t('Mot de passe fictif', 'Sample password')}<input readonly type="password" value="sample-only-not-a-password"></label>
    ${admin ? `<label>${t('Code de connexion fictif', 'Sample sign-in code')}<input readonly value="000000"></label>` : ''}
    <p id="authModeLabel" role="status"></p>
    <p class="small">${admin ? t('Accès réel sur invitation et approbation, avec code de connexion. La création ne donne aucun droit administrateur.', 'Real access requires invitation, approval and a sign-in code. Registration grants no admin rights.') : driver ? t('La création ouvre un dossier candidat. Identité, permis, véhicule et assurance doivent être approuvés avant toute course.', 'Registration opens an application. Identity, licence, vehicle and insurance require approval before any rides.') : t('Profil fictif uniquement.', 'Sample profile only.')}</p>
    </div></section>`;
  let mode = 'signin';
  const signin = container.querySelector('#signInTab');
  const create = container.querySelector('#createTab');
  const status = container.querySelector('#authModeLabel');
  const setMode = next => {
    mode = next;
    signin.classList.toggle('active', mode === 'signin');
    create.classList.toggle('active', mode === 'create');
    signin.setAttribute('aria-pressed', String(mode === 'signin'));
    create.setAttribute('aria-pressed', String(mode === 'create'));
    status.textContent = mode === 'create'
      ? t('Création fictive — aucun compte réel enregistré', 'Simulated registration — no real account saved')
      : t('Connexion de démonstration', 'Demonstration sign-in');
    action.textContent = mode === 'create' && (admin || driver)
      ? t('Simuler la demande de compte', 'Simulate account application')
      : t('Continuer avec le profil fictif', 'Continue with sample profile');
  };
  signin.onclick = () => setMode('signin');
  create.onclick = () => setMode('create');
  setMode('signin');
  return { requiresApproval: () => mode === 'create' && (admin || driver) };
}
