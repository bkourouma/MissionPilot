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
import { chargerServeur } from "../../../../lib/api-serveur";
import { nomPays } from "../../../../lib/cabinet";
import { TAILLE_LIBELLES, type ClientDetaille } from "../../../../lib/clients";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";
import { ArchivageClient } from "./ArchivageClient";
import { AjoutContact, ContactModifiable } from "./Contacts";

export const metadata: Metadata = { title: "Fiche client" };

const ou = (v: string | null) => v ?? "—";

export default async function PageClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("clients.lire");
  const peutEcrire = aPermission(utilisateur.roles, "clients.ecrire");
  const r = await chargerServeur<ClientDetaille>(`/api/clients/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Fiche client" retour={{ href: "/clients", libelle: "Clients" }} />
        <EtatErreur
          titre="La fiche du client n'a pas pu être chargée."
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
        retour={{ href: "/clients", libelle: "Clients" }}
        badges={
          c.actif ? (
            <BadgeStatut tonalite="succes">Actif</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">Archivé</BadgeStatut>
          )
        }
        soustitre={[c.secteur, nomPays(c.pays)].filter(Boolean).join(" · ")}
        actions={
          peutEcrire ? (
            <>
              <Link href={`/clients/${c.id}/modifier`} className={classesBouton("secondaire")}>
                <Icone nom="crayon" />
                <span>Modifier</span>
              </Link>
              <ArchivageClient client={c} />
            </>
          ) : null
        }
      />

      <Carte titre="Identité légale">
        <dl className="mp-liste-def">
          <div>
            <dt>Raison sociale</dt>
            <dd>{c.raison_sociale}</dd>
          </div>
          <div>
            <dt>Forme juridique</dt>
            <dd>{ou(c.forme_juridique)}</dd>
          </div>
          <div>
            <dt>Numéro RCCM</dt>
            <dd>{ou(c.rccm)}</dd>
          </div>
          <div>
            <dt>Compte contribuable</dt>
            <dd>{ou(c.compte_contribuable)}</dd>
          </div>
          <div>
            <dt>Secteur</dt>
            <dd>{ou(c.secteur)}</dd>
          </div>
          <div>
            <dt>Pays</dt>
            <dd>{nomPays(c.pays)}</dd>
          </div>
          <div>
            <dt>Taille</dt>
            <dd>{c.taille ? TAILLE_LIBELLES[c.taille] : "—"}</dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd className="mp-texte-preserve">{ou(c.adresse)}</dd>
          </div>
        </dl>
      </Carte>

      <section aria-labelledby="titre-contacts" className="mp-pile">
        <h2 id="titre-contacts" className="mp-section__titre">
          Contacts
        </h2>
        {c.contacts.length === 0 ? (
          <EtatVide titre="Aucun contact enregistré pour ce client." icone="personnes">
            {peutEcrire ? <p>Ajoutez au moins l&apos;interlocuteur principal.</p> : null}
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
