import Link from "next/link";
import type { Metadata } from "next";
import type { DemandeSignaturePortailApi } from "@missionpilot/shared";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { pageDepuis } from "../../../../lib/canaux";
import { hrefPage, lireCurseur, peut, requetePage } from "../../../../lib/portail";
import {
  API_SIGNATURES_PORTAIL,
  avancementPortail,
  cheminSignaturePortail,
  CHEMIN_SIGNATURES_PORTAIL,
  libelleMonStatut,
  libelleObjetPortail,
  libelleStatutPortail,
} from "../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";
import { AVERTISSEMENT_SIGNATURE_SIMULEE, libelleEcheance } from "../../../../lib/signatures";

export const metadata: Metadata = { title: "Signatures" };

/** Documents que votre cabinet vous demande de signer. Signature SIMULÉE : sans valeur juridique. */
export default async function SignaturesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.signature.signer")) {
    return <NonDisponible titre="Signatures" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<unknown>(requetePage(API_SIGNATURES_PORTAIL, curseur));
  const page = r.ok ? pageDepuis<DemandeSignaturePortailApi>(r.donnees) : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Signatures"
        soustitre="Les documents que votre cabinet vous demande de signer, et ceux que vous avez déjà signés."
      />
      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_SIGNATURE_SIMULEE}>
        <p>
          La signature se fait ici, après confirmation de votre identité. Aucun envoi réel n&apos;a
          lieu.
        </p>
      </Alerte>
      {!r.ok ? (
        <EtatErreur
          titre="La liste des signatures n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_SIGNATURES_PORTAIL, curseur)}
        />
      ) : page && page.elements.length === 0 ? (
        <EtatVide titre="Aucun document à signer pour le moment." icone="signature">
          <p>Quand votre cabinet vous enverra un document à signer, il apparaîtra ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {(page?.elements ?? []).map((d) => {
            const etat = libelleMonStatut(d);
            return (
              <li key={d.id}>
                <Carte
                  className="mp-module"
                  niveauTitre={2}
                  titre={
                    <Link href={cheminSignaturePortail(d.id)} className="mp-lien-etendu">
                      {libelleObjetPortail(d.objet)}
                    </Link>
                  }
                  actions={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
                >
                  <p className="mp-texte-doux">
                    {`${libelleStatutPortail(d.statut)} · ${avancementPortail(d)} · échéance : ${libelleEcheance(d.expire_le)}`}
                  </p>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}
      {page ? (
        <PaginationCurseur
          hrefSuivante={page.suivant ? hrefPage(CHEMIN_SIGNATURES_PORTAIL, page.suivant) : null}
          hrefDebut={curseur ? CHEMIN_SIGNATURES_PORTAIL : null}
          libelle="Pages des signatures"
        />
      ) : null}
    </div>
  );
}
