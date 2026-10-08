import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Carte } from "../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone, type NomIcone } from "../../../components/ui/Icone";
import { resumePartages, issueErreurPortail, type ElementPartage } from "../../../lib/portail";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "../../../lib/portail-routes";
import { chargerProfilPortail, obtenirSessionPortail } from "../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Accueil" };

const ICONES: Record<ElementPartage["id"], NomIcone> = {
  missions: "dossier",
  documents: "trombone",
  factures: "facture",
};

/** Accueil de l'espace client : entreprise, cabinet, interlocuteur et ce qui est partagé. */
export default async function AccueilPortail() {
  const { utilisateur } = await obtenirSessionPortail();
  const r = await chargerProfilPortail();
  if (!r.ok && issueErreurPortail(r.statut, r.code) === "securite") {
    redirect(CHEMIN_SECURITE_PORTAIL);
  }
  if (!r.ok) {
    return (
      <div className="mp-page">
        <header className="mp-page__entete">
          <h1 className="mp-page__titre">Bonjour {utilisateur.nom}</h1>
        </header>
        <EtatErreur
          titre="Votre espace client n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={CHEMIN_PORTAIL}
        />
      </div>
    );
  }

  const { entreprise, cabinet, contact_principal: contact, partages } = r.donnees;
  const elements = resumePartages(partages, utilisateur.roles);

  return (
    <div className="mp-page">
      <header className="mp-page__entete">
        <h1 className="mp-page__titre">Bonjour {utilisateur.nom}</h1>
        <p className="mp-page__soustitre">
          Bienvenue dans l&apos;espace client de {entreprise.raison_sociale}, mis à votre
          disposition par {cabinet.nom}.
        </p>
      </header>

      {elements.length === 0 ? (
        <EtatVide titre="Rien n'a encore été partagé avec vous." icone="info">
          <p>
            Dès que {cabinet.nom} partagera une mission, un document ou une facture, vous le
            retrouverez ici.
          </p>
        </EtatVide>
      ) : null}

      <div className="mp-grille-cartes">
        {elements.length > 0 ? (
          <Carte titre="Ce que votre cabinet partage avec vous">
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

        <Carte titre="Votre interlocuteur">
          {contact ? (
            <dl className="mp-liste-def mp-liste-def--compacte">
              <div>
                <dt>Nom</dt>
                <dd>{contact.nom}</dd>
              </div>
              {contact.email ? (
                <div>
                  <dt>Adresse e-mail</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Cabinet</dt>
                <dd>{cabinet.nom}</dd>
              </div>
            </dl>
          ) : (
            <p>
              {cabinet.nom} n&apos;a pas encore désigné d&apos;interlocuteur pour cet espace. Vous
              pouvez continuer à joindre l&apos;équipe de la mission comme d&apos;habitude.
            </p>
          )}
        </Carte>
      </div>

      <p className="mp-portail-note">
        Vous ne voyez ici que les informations que {cabinet.nom} a choisi de partager avec{" "}
        {entreprise.raison_sociale}. Elles sont mises à jour par le cabinet au fil de la mission.
      </p>
    </div>
  );
}
