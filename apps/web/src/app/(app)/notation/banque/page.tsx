import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/notation/notation.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import {
  cheminBanque,
  lireStatutBanque,
  type ElementBanque,
  type Page,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Banque d'items de notation" };

/**
 * Banque d'items standard étalonnée du cabinet (NOT-09) : dernière version de chaque item,
 * statut, version validée en service. Un item ne sert au questionnaire adaptatif qu'une fois
 * validé par un expert métier ; sa rédaction passe aujourd'hui par l'API (POST /api/notation/banque).
 */
export default async function PageBanqueNotation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerLectureNotation();
  const q = await searchParams;
  const statut = lireStatutBanque(q.statut);
  const curseur = typeof q.curseur === "string" ? q.curseur : "";
  const r = await chargerServeur<Page<ElementBanque>>(cheminBanque(curseur, statut));
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Banque d'items"
        soustitre="Pratiques évaluées, échelles à ancrages comportementaux et formulations par public. Seuls les items validés servent aux questionnaires adaptatifs."
      />
      <p>
        Filtrer : <Link href="/notation/banque">tous</Link> ·{" "}
        <Link href="/notation/banque?statut=valide">validés</Link> ·{" "}
        <Link href="/notation/banque?statut=brouillon">brouillons</Link>
      </p>
      <Carte titre="Items">
        {!r.ok ? (
          <EtatErreur
            titre="La banque n'a pas pu être chargée."
            message={r.message}
            hrefReessayer="/notation/banque"
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun item dans la banque." icone="info">
            <p>Les items se rédigent en brouillon puis sont validés par un expert métier.</p>
          </EtatVide>
        ) : (
          <>
            <Tableau
              legende="Items de la banque"
              cleLigne={(i) => i.id}
              lignes={r.donnees.elements}
              colonnes={[
                { cle: "code", entete: "Code" },
                { cle: "intitule", entete: "Pratique" },
                { cle: "dimension", entete: "Dimension" },
                { cle: "version", entete: "Version", alignement: "droite" },
                {
                  cle: "statut",
                  entete: "Statut",
                  rendu: (i) => (
                    <BadgeStatut tonalite={i.statut === "valide" ? "succes" : "neutre"}>
                      {i.statut === "valide" ? "Validé" : "Brouillon"}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "version_validee",
                  entete: "En service",
                  rendu: (i) => (i.version_validee ? `version ${i.version_validee}` : "aucune"),
                },
                {
                  cle: "modifie_le",
                  entete: "Modifié le",
                  rendu: (i) => formaterDate(i.modifie_le),
                },
              ]}
            />
            {r.donnees.curseur_suivant ? (
              <p>
                <Link
                  href={`/notation/banque?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}${statut ? `&statut=${statut}` : ""}`}
                >
                  Items suivants
                </Link>
              </p>
            ) : null}
          </>
        )}
      </Carte>
    </div>
  );
}
