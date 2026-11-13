import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Onglets } from "../../../../components/ui/Onglets";
import { chargerServeur } from "../../../../lib/api-serveur";
import { nomPays } from "../../../../lib/cabinet";
import { cheminSyntheseClient } from "../../../../lib/canaux";
import { cheminDiagnosticFlash, libelleTaille, type ClientDetaille } from "../../../../lib/clients";
import { estIdentifiant } from "../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { ongletsClientAvecPortail } from "../../../../lib/portail-gestion";
import { ArchivageClient } from "./ArchivageClient";
import { AjoutContact, ContactModifiable } from "./Contacts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Fiche client", "Client record") };
}

const ou = (v: string | null) => v ?? "—";

export default async function PageClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("clients.lire");
  const peutEcrire = aPermission(utilisateur.roles, "clients.ecrire");
  const voitApercuSynthese = aPermission(utilisateur.roles, "canaux.lire");
  const peutProposerDiagnostic = aPermission(utilisateur.roles, "catalogue.lire");
  const r = await chargerServeur<ClientDetaille>(`/api/clients/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Fiche client", "Client record")}
          retour={{ href: "/clients", libelle: t("Clients", "Clients") }}
        />
        <EtatErreur
          titre={t(
            "La fiche du client n'a pas pu être chargée.",
            "The client record could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/clients/${id}`}
        />
      </div>
    );
  }
  const c = r.donnees;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c.raison_sociale}
        retour={{ href: "/clients", libelle: t("Clients", "Clients") }}
        badges={
          c.actif ? (
            <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">{t("Archivé", "Archived")}</BadgeStatut>
          )
        }
        soustitre={[c.secteur, nomPays(c.pays, langue)].filter(Boolean).join(" · ")}
        actions={
          peutEcrire || voitApercuSynthese || (peutProposerDiagnostic && c.actif) ? (
            <>
              {voitApercuSynthese ? (
                <Link href={cheminSyntheseClient(c.id)} className={classesBouton("secondaire")}>
                  <Icone nom="oeil" />
                  <span>{t("Synthèse du dirigeant", "Executive summary")}</span>
                </Link>
              ) : null}
              {peutProposerDiagnostic && c.actif ? (
                <Link href={cheminDiagnosticFlash(c.id)} className={classesBouton("secondaire")}>
                  <Icone nom="courbe" />
                  <span>{t("Proposer un diagnostic flash", "Offer a flash diagnostic")}</span>
                </Link>
              ) : null}
              {peutEcrire ? (
                <>
                  <Link href={`/clients/${c.id}/modifier`} className={classesBouton("secondaire")}>
                    <Icone nom="crayon" />
                    <span>{t("Modifier", "Edit")}</span>
                  </Link>
                  <ArchivageClient client={c} />
                </>
              ) : null}
            </>
          ) : null
        }
      />

      <Onglets
        libelle={t("Sections de la fiche client", "Client record sections")}
        pages={ongletsClientAvecPortail(c.id, utilisateur.roles, langue)}
      />

      <Carte titre={t("Identité légale", "Legal identity")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Raison sociale", "Company name")}</dt>
            <dd>{c.raison_sociale}</dd>
          </div>
          <div>
            <dt>{t("Forme juridique", "Legal form")}</dt>
            <dd>{ou(c.forme_juridique)}</dd>
          </div>
          <div>
            <dt>{t("Numéro RCCM", "RCCM number")}</dt>
            <dd>{ou(c.rccm)}</dd>
          </div>
          <div>
            <dt>{t("Compte contribuable", "Taxpayer account")}</dt>
            <dd>{ou(c.compte_contribuable)}</dd>
          </div>
          <div>
            <dt>{t("Secteur", "Industry")}</dt>
            <dd>{ou(c.secteur)}</dd>
          </div>
          <div>
            <dt>{t("Pays", "Country")}</dt>
            <dd>{nomPays(c.pays, langue)}</dd>
          </div>
          <div>
            <dt>{t("Taille", "Size")}</dt>
            <dd>{c.taille ? libelleTaille(c.taille, langue) : "—"}</dd>
          </div>
          <div>
            <dt>{t("Adresse", "Address")}</dt>
            <dd className="mp-texte-preserve">{ou(c.adresse)}</dd>
          </div>
        </dl>
      </Carte>

      <section aria-labelledby="titre-contacts" className="mp-pile">
        <h2 id="titre-contacts" className="mp-section__titre">
          {t("Contacts", "Contacts")}
        </h2>
        {c.contacts.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucun contact enregistré pour ce client.",
              "No contact recorded for this client.",
            )}
            icone="personnes"
          >
            {peutEcrire ? (
              <p>
                {t(
                  "Ajoutez au moins l'interlocuteur principal.",
                  "Add at least the primary contact.",
                )}
              </p>
            ) : null}
          </EtatVide>
        ) : (
          <ul className="mp-liste-cartes">
            {c.contacts.map((contact) => (
              <li key={contact.id}>
                <ContactModifiable clientId={c.id} contact={contact} peutEcrire={peutEcrire} />
              </li>
            ))}
          </ul>
        )}
        {peutEcrire ? <AjoutContact clientId={c.id} /> : null}
      </section>
    </div>
  );
}
