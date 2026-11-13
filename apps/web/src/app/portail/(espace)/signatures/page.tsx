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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
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
import { avertissementSignatureSimulee, libelleEcheance } from "../../../../lib/signatures";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Signatures", "Signatures") };
}

/** Documents que votre cabinet vous demande de signer. Signature SIMULÉE : sans valeur juridique. */
export default async function SignaturesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.signature.signer")) {
    return <NonDisponible titre={t("Signatures", "Signatures")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<unknown>(requetePage(API_SIGNATURES_PORTAIL, curseur));
  const page = r.ok ? pageDepuis<DemandeSignaturePortailApi>(r.donnees) : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Signatures", "Signatures")}
        soustitre={t(
          "Les documents que votre cabinet vous demande de signer, et ceux que vous avez déjà signés.",
          "The documents your firm asks you to sign, and those you have already signed.",
        )}
      />
      <Alerte tonalite="attention" annonce="aucune" titre={avertissementSignatureSimulee(langue)}>
        <p>
          {t(
            "La signature se fait ici, après confirmation de votre identité. Aucun envoi réel n'a lieu.",
            "Signing is done here, after confirming your identity. No real sending takes place.",
          )}
        </p>
      </Alerte>
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des signatures n'a pas pu être chargée.",
            "The list of signatures could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_SIGNATURES_PORTAIL, curseur)}
        />
      ) : page && page.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucun document à signer pour le moment.", "No document to sign for now.")}
          icone="signature"
        >
          <p>
            {t(
              "Quand votre cabinet vous enverra un document à signer, il apparaîtra ici.",
              "When your firm sends you a document to sign, it will appear here.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {(page?.elements ?? []).map((d) => {
            const etat = libelleMonStatut(d, langue);
            return (
              <li key={d.id}>
                <Carte
                  className="mp-module"
                  niveauTitre={2}
                  titre={
                    <Link href={cheminSignaturePortail(d.id)} className="mp-lien-etendu">
                      {libelleObjetPortail(d.objet, langue)}
                    </Link>
                  }
                  actions={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
                >
                  <p className="mp-texte-doux">
                    {t(
                      `${libelleStatutPortail(d.statut)} · ${avancementPortail(d)} · échéance : ${libelleEcheance(d.expire_le)}`,
                      `${libelleStatutPortail(d.statut, langue)} · ${avancementPortail(d, langue)} · due: ${libelleEcheance(d.expire_le, langue)}`,
                    )}
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
          libelle={t("Pages des signatures", "Signature pages")}
        />
      ) : null}
    </div>
  );
}
