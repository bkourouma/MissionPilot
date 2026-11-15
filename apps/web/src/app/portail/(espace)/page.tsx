import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Carte } from "../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone, type NomIcone } from "../../../components/ui/Icone";
import { resumePartages, issueErreurPortail, type ElementPartage } from "../../../lib/portail";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "../../../lib/portail-routes";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { chargerProfilPortail, obtenirSessionPortail } from "../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Accueil", "Home") };
}

const ICONES: Record<ElementPartage["id"], NomIcone> = {
  missions: "dossier",
  documents: "trombone",
  factures: "facture",
};

/** Accueil de l'espace client : entreprise, cabinet, interlocuteur et ce qui est partagé. */
export default async function AccueilPortail() {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSessionPortail();
  const r = await chargerProfilPortail();
  if (!r.ok && issueErreurPortail(r.statut, r.code) === "securite") {
    redirect(CHEMIN_SECURITE_PORTAIL);
  }
  if (!r.ok) {
    return (
      <div className="mp-page">
        <header className="mp-page__entete">
          <h1 className="mp-page__titre">
            {t("Bonjour", "Hello")} {utilisateur.nom}
          </h1>
        </header>
        <EtatErreur
          titre={t(
            "Votre espace client n'a pas pu être chargé.",
            "Your client space could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={CHEMIN_PORTAIL}
        />
      </div>
    );
  }

  const { entreprise, cabinet, contact_principal: contact, partages } = r.donnees;
  const elements = resumePartages(partages, utilisateur.roles, langue);

  return (
    <div className="mp-page">
      <header className="mp-page__entete">
        <h1 className="mp-page__titre">
          {t("Bonjour", "Hello")} {utilisateur.nom}
        </h1>
        <p className="mp-page__soustitre">
          {t(
            `Bienvenue dans l'espace client de ${entreprise.raison_sociale}, mis à votre disposition par ${cabinet.nom}.`,
            `Welcome to the client space of ${entreprise.raison_sociale}, provided to you by ${cabinet.nom}.`,
          )}
        </p>
      </header>

      {elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Rien n'a encore été partagé avec vous.",
            "Nothing has been shared with you yet.",
          )}
          icone="info"
        >
          <p>
            {t(
              `Dès que ${cabinet.nom} partagera une mission, un document ou une facture, vous le retrouverez ici.`,
              `As soon as ${cabinet.nom} shares an engagement, a document or an invoice, you will find it here.`,
            )}
          </p>
        </EtatVide>
      ) : null}

      <div className="mp-grille-cartes">
        {elements.length > 0 ? (
          <Carte
            titre={t("Ce que votre cabinet partage avec vous", "What your firm shares with you")}
          >
            <ul className="mp-portail-partages">
              {elements.map((e) => (
                <li key={e.id} className="mp-portail-partages__element">
                  <Icone nom={ICONES[e.id]} />
                  {e.href ? <Link href={e.href}>{e.texte}</Link> : <span>{e.texte}</span>}
                </li>
              ))}
            </ul>
          </Carte>
        ) : null}

        <Carte titre={t("Votre interlocuteur", "Your contact person")}>
          {contact ? (
            <dl className="mp-liste-def mp-liste-def--compacte">
              <div>
                <dt>{t("Nom", "Name")}</dt>
                <dd>{contact.nom}</dd>
              </div>
              {contact.email ? (
                <div>
                  <dt>{t("Adresse e-mail", "Email address")}</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{t("Cabinet", "Firm")}</dt>
                <dd>{cabinet.nom}</dd>
              </div>
            </dl>
          ) : (
            <p>
              {t(
                `${cabinet.nom} n'a pas encore désigné d'interlocuteur pour cet espace. Vous pouvez continuer à joindre l'équipe de la mission comme d'habitude.`,
                `${cabinet.nom} has not yet appointed a contact person for this space. You can keep reaching the engagement team as usual.`,
              )}
            </p>
          )}
        </Carte>
      </div>

      <p className="mp-portail-note">
        {t(
          `Vous ne voyez ici que les informations que ${cabinet.nom} a choisi de partager avec ${entreprise.raison_sociale}. Elles sont mises à jour par le cabinet au fil de la mission.`,
          `You only see here the information that ${cabinet.nom} has chosen to share with ${entreprise.raison_sociale}. It is updated by the firm throughout the engagement.`,
        )}
      </p>
    </div>
  );
}
